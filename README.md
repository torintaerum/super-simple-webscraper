super-simple-webscraper
=======================

Super simple webpage scraper. This script is a super _simple_ webpage scraper. It requests the url passed and then parses it searching for:

 * <img src="path/to/an/image.png">
 * <link rel="stylesheet" href="path/to/a/stylesheet.css">
 * <script src="path/to/some/javascript.js"></script>

The script then requests all these assets and places them inline in the output. 

 * <img src="..."> becomes <img src="data:image/png;base64,isndifnisdf=">
 * <link rel="stylesheet" href="..."> becomes <style>contents of css</style>
 * <script src="..."></script> becomes <script>contents of js</script>

Then the script searches for url(...) for the background images and replaces them with url(data:image/gif;base64,sodfosidfoik=)

Currently output is only to stdout, sometimes when matching url(...) some bogus requests are made especially if the string was found outside of
a css source (fairly easy to fix). It also seems to miss some resources sometimes (not sure what's going on there).

Usage
-----

`node ws.js <url> > <output.html>`