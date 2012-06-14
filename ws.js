var http = require('http');
var https = require('https');
var url = require('url');
var util = require('util');
var path = require('path');
var zlib = require('zlib');

if(process.argv.length < 3) {
    console.log('usage:\n\tnode ws.js <url>');
}

var page = url.parse(process.argv[2]);
var default_proto = page.protocol.indexOf('s') != -1 ? https : http;
var rootpath = path.dirname(page.pathname);

var headers = {
    "connection":"keep-alive",
    "user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/536.5 (KHTML, like Gecko) Chrome/19.0.1084.52 Safari/536.5",
    // //"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
//    "accept-encoding":"gzip",
    // "accept-language":"en-US,en;q=0.8",
    // "accept-charset":"ISO-8859-1,utf-8;q=0.7,*;q=0.3"
    accept : '*/*'
};

function get(opts, cb) {
    var h = default_proto;
    if(opts.proto)
        if(opts.proto.indexOf('s') != -1)
            h = https;
    opts.headers = headers;
    opts.headers.host = opts.host;
    // console.error(util.inspect(opts));

    h.get(opts, function(res) {
        if(res.statusCode == 301 || 
           res.statusCode == 302 || 
           res.statusCode == 303 || 
           res.statusCode == 305 || 
           res.statusCode == 307) {
            var red = url.parse(res.headers.location);
            var p = red.path.replace(/http:\x2f\x2f/g,'');
            p = p.replace(/https:\x2f\x2f/g,'');
            var o = {
                proto : red.protocol,
                hostname : red.hostname,
                path : p,
                port : red.port,
                _usr : opts._usr,
                _attr : opts._attr,
                _enc : opts._enc                
            };
//            console.error('redirecting to ' + res.headers.location);
            get(o,cb);
        } else {
            if(res.statusCode != 200) {
                console.error('request failed with code ' + res.statusCode);
                return cb(res.statusCode, {req:opts});
            }
            var chunks = [];
            var length = 0;

            res.on('data', function(chnk) { chunks.push(chnk); length += chnk.length; });
            res.on('end', function() { 
                var buf = new Buffer(length);
                var pos = 0;
                for(var i=0;i<chunks.length;++i) {
                    chunks[i].copy(buf,pos);
                    pos += chunks[i].length;
                }
                var comp = false;
                for(h in res.headers) {
                    var lw = h.toLowerCase();
                    if(lw == 'content-type') {
                        opts.mime = res.headers[h];
                    }
                    if(lw == 'content-encoding') {
                        if(res.headers[h] == 'gzip') {
                            comp = true;
                            zlib.Unzip(buf, function(err, b) {
                                if(err) {
                                    cb(err);
                                } else {
                                    cb(null,{req:opts,buf:b});
                                }
                            });
                        }
                    }
                }
                if(!comp)
                    cb(null,{req:opts,buf:buf}); 
            });
        }
    }).on('error', function(err) {
        console.error('GET error: ' + err);
        cb(err,{req:opts});
    });
};

var stylesheet_offsets = [];

function replace_urls(src) {

    stylesheet_offsets.sort(function(a,b) {
        if(a.offset < b.offset) return -1;
        if(a.offset > b.offset) return 1;
        return 0;
    });

    var u = /url\x28/g;
    var r;
    var ind = [];
    while((r = u.exec(src))) {
        ind.push(r.index);
    }

//    console.error('matches ' + ind.length);

    var resources = {};
    var urls = [];
    for(var i=0;i<ind.length;++i) {
        var u = src.indexOf('(',ind[i]);
        var v = src.indexOf(')',u);
        var w = src.substr(ind[i]+3,u-ind[i]-3);
        var uri = src.substr(u+1,v-(u+1));

        uri = uri.replace(/'/g,'');
        uri = uri.replace(/"/g,'');
//        console.error('uri: ' + uri);

        if(uri.indexOf('data:image') != -1) continue;
        if(w.length) {
            if(w.search(/\S/) != -1)
                continue;
        }

        var style = {};
        for(var j=0;j<stylesheet_offsets.length;++j) {
            if(stylesheet_offsets[j].offset > ind[i] && j > 0) {
                break;
            }
            style = stylesheet_offsets[j]
        }

        if(!style.uri) style.uri = {};

        if(!style.uri.proto) style.uri.proto = 'http:';
        if(!style.uri.hostname) style.uri.hostname = page.hostname;
        
        var parsed = url.parse(uri);
        if(!parsed.path) continue;

        var ctx = {};
        if(uri.indexOf('//') == 0) {
            uri = page.protocol + uri;
        } else if(parsed.protocol) { 
            // nothing
        } else {
            var x = style.uri.proto + '//' + style.uri.hostname;
            if(style.uri.port) x += ':' + style.uri.port;
            if(parsed.path.indexOf('/') == 0) {
                x += parsed.path;
                uri = x;
            } else {
                var p = path.dirname(style.uri.path);
//                console.error(p);
                if(p == '.') p = '/';
                x += path.normalize(path.join('/',p,parsed.path));
                uri = x;
            }
        }

        ctx.uri = uri;
        ctx.u = u;
        ctx.v = v;
        urls.push(ctx);
        resources[ctx.uri] = ctx;
    }
    var count = 0;
    for(a in resources) {
        ++count;
    }
    var failed = 0;
    var retrieved = 0;

    for(a in resources) {
        var sq = url.parse(resources[a].uri);
        var op = {
            proto : sq.protocol,
            hostname : sq.hostname,
            path : path.resolve(rootpath,sq.path),
            port : sq.port,
            _usr : resources[a].uri,
            _attr : '',
            _enc : 'base64'            
        };

        if(!op.hostname) op.hostname = page.hostname;
        if(!op.port) op.port = page.port;
        
  //      console.error(util.inspect(op));

        var output = '';
        get(op, function(err,val) {
            if(err) {
                ++failed;
                console.error('failed to retrieve ' + val.req._usr + ' ' + err);
                console.error('failed resources ' + failed + ' of total ' + count);
                if(retrieved + failed == count) {
                    var pred = function(a,b) {
                        if(a.u < b.u) return -1;
                        if(a.u > b.u) return 1;
                        return 0;
                    }
                    urls.sort(pred);
                    var at = 0;
                    for(var i=0;i<urls.length;++i) {
                        if(resources[urls[i].uri].result) {
                            output += src.substr(at,urls[i].u+1-at);
                            var mime = resources[urls[i].uri].mime;
                            if(mime) {
                                mime = mime.split('/')[1];
                            } else {
                                mime = 'png';
                            }
                            output += 'data:image/' + mime + ';base64,';
                            output += resources[urls[i].uri].result;
                            at = urls[i].v;
                        }
                    }        
                    output += src.substr(at);
                    process.stdout.write(output);
                }
            } else {
                ++retrieved;
                // console.error('retrieved resources ' + retrieved + ' of total ' + count);
                resources[val.req._usr].result = val.buf.toString('base64');
                resources[val.req._usr].mime = val.req.mime;
                if(retrieved + failed == count) {
                    var pred = function(a,b) {
                        if(a.u < b.u) return -1;
                        if(a.u > b.u) return 1;
                        return 0;
                    }
                    urls.sort(pred);
                    var at = 0;
                    for(var i=0;i<urls.length;++i) {
                        if(resources[urls[i].uri].result) {
                            output += src.substr(at,urls[i].u+1-at);
                            var mime = resources[urls[i].uri].mime;
                            if(mime) {
                                mime = mime.split('/')[1];
                            } else {
                                mime = 'png';
                            }
                            output += 'data:image/' + mime + ';base64,';
                            output += resources[urls[i].uri].result;
                            at = urls[i].v;
                        }
                    }        
                    output += src.substr(at);
                    process.stdout.write(output);
                }
            }
        });
    }

    if(count == 0) {
        process.stdout.write(src);
    }
}

var final_result = '';

var op = {
    proto : page.protocol,
    hostname : page.hostname,
    path : page.path,
    port : page.port
};

// console.error(util.inspect(op));

get(op, function(err, res) {
    if(err) {
        console.error(err);
        process.exit(1);
    }
    var lk = /<link/g;
    var sc = /<script/g;
    var img = /<img/g;
    var r;
    var html = res.buf.toString();

    var script_indices = [];
    var scripts = {};
    while((r = sc.exec(html))) {
        script_indices.push(r.index);
    }

    var img_indices = [];
    var imgs = {};
    while((r = img.exec(html))) {
        img_indices.push(r.index);
    }

    var css_indices = [];
    var stylesheets = {};
    while((r = lk.exec(html))) {
        css_indices.push(r.index);
    }

    var resources = {};
    var tags = [];
    var get_resources = function(hash, indices, attr, enc) {
        for(var i=indices.length-1;i>=0;--i) {
            var end = html.indexOf('>', indices[i]);
            var tag = html.substr(indices[i], end - indices[i] + 1);
            var src = tag.indexOf(attr);
            var _i = '';
            _i += i;
            if(src != -1) {
                if(attr == 'href') {
                    if(tag.indexOf('stylesheet') == -1 && tag.indexOf('text/css') == -1) {
                        continue;
                    }
                }
                var u = tag.indexOf('"',src);
                var v = tag.indexOf('"',u+1);
                var uu = tag.indexOf("'",src);
                var vv = tag.indexOf("'",uu+1);
                if(u == -1) u = uu;
                else if(uu < u && uu > 0) u = uu;
                if(v == -1) v = vv;
                else if(vv < v && vv > 0) v = vv;
                var ur = tag.substr(u+1,v-u-1);
                if(ur.indexOf('data:image') != -1) continue;
                var ss = url.parse(ur);
                if(!ss.hostname) ss.hostname = page.hostname;
                if(!ss.port) ss.port = page.port;
                if(!ss.protocol) ss.protocol = 'http:';
                var sq = {
                    proto : ss.protocol,
                    hostname : ss.hostname,
                    path : path.resolve(rootpath,ss.path),
                    port : ss.port,
                    _usr : ur,
                    _attr : attr,
                    _enc : enc
                };
                var ctx = {};
                ctx.uri = sq;
                ctx.tag_begin = indices[i];
                ctx.tag_end = end;
                ctx.src_begin = src;
                ctx.src_end = v;
                ctx.val = ur;
                ctx.enc = enc;
                ctx.attr = attr;
                tags.push(ctx);
                resources[ctx.val] = ctx;
            }
        }   
    };
 
    get_resources(scripts,script_indices,'src','utf8');
    get_resources(imgs,img_indices,'src','base64');
    get_resources(stylesheets,css_indices,'href','utf8');

    var count = 0;
    for(a in resources) {
        ++count;
    }
    
    var retrieved = 0;
    var failed = 0;

    var once = 0;

    for(a in resources) {
        get(resources[a].uri, function(err,val) {
            if(err) {
                ++failed;
                console.error('failed to retrieve ' + val.req._usr);
            } else {
                ++retrieved;
                resources[val.req._usr].result = val.buf.toString(val.req._enc);
                resources[val.req._usr].mime = val.req.mime;
                if(retrieved + failed == count) {
                    var pred = function(a,b) {
                        if(a.tag_begin < b.tag_begin) return -1;
                        if(a.tag_begin > b.tag_begin) return 1;
                        return 0;
                    }
                    tags.sort(pred);
                    var at = 0;
                    for(var i=0;i<tags.length;++i) {
                        if(tags[i].attr == 'href') {
                            final_result += html.substr(at,tags[i].tag_begin - at);
                            stylesheet_offsets.push({
                                uri : tags[i].uri,
                                offset : final_result.length
                            });
                            final_result += '<style>\n/* ' + tags[i].val + ' */\n';
                            final_result += resources[tags[i].val].result;
                            final_result += '</style>';
                            at = tags[i].tag_end + 1;
                        } else if(tags[i].enc == 'base64') {
                            final_result += html.substr(at,tags[i].tag_begin + tags[i].src_begin - at);
                            at = tags[i].tag_begin;
                            var mime = resources[tags[i].val].mime;
                            if(mime) {
                                mime = mime.split('/')[1];
                            } else {
                                mime = 'png';
                            }
                            final_result += 'src="data:image/' + mime + ';base64,';
                            final_result += resources[tags[i].val].result;
                            final_result += '" ';
                            var app = html.substr(at + tags[i].src_end + 1, tags[i].tag_end - (at + tags[i].src_end));
                            final_result += app;
                            at = tags[i].tag_end + 1;
                        } else {
                            final_result += html.substr(at,tags[i].tag_begin - at);
                            final_result += '<script>\n/* ' + tags[i].val + ' */\n';
                            final_result += resources[tags[i].val].result;
                            at = tags[i].tag_end + 1;
                        }
                    }
                    final_result += html.substr(at);
                    replace_urls(final_result);
                }
            }
        });
    }

    if(count == 0) {
        replace_urls(html);        
    }
});

