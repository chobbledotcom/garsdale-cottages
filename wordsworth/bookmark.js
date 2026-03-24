var txt = "Bookmark Wordsworth Country"
var url = "http://www.wordsworthcountry.com"
var who = "Wordsworth Country"
var ver = navigator.appName
var num = parseInt(navigator.appVersion)
if ((ver == "Microsoft Internet Explorer")&&(num >= 4)) {
   document.write('<a href="javascript:window.external.AddFavorite(url,who);" ');
   document.write('onMouseOver=" window.status=')
   document.write("txt; return true ")
   document.write('"onMouseOut=" window.status=')
   document.write("' '; return true ")
   document.write('">'+ txt + '</a>')
}else{
   txt += "  (Ctrl+D)"
   document.write(txt)
}