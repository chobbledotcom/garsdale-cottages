// Copyright (C) 2005-2008 Ilya S. Lyubinskiy. All rights reserved.
// Technical support: http://www.php-development.ru/
//
// YOU MAY NOT
// (1) Remove or modify this copyright notice.
// (2) Re-distribute this code or any part of it.
//     Instead, you may link to the homepage of this code:
//     http://www.php-development.ru/php-scripts/click-tracker.php
// (3) Use this code as part of another product.
//
// YOU MAY
// (1) Use this code on your website.
//
// NO WARRANTY
// This code is provided "as is" without warranty of any kind.
// You expressly acknowledge and agree that use of this code is at your own risk.


// ***** Aux *******************************************************************

// ***** clicktracker_inarray  *****

function clicktracker_inarray (arr, val)
{
  for (var i in arr) if (arr[i] == val) return true;
  return false;
}

// ***** clicktracker_innertxt *****

function clicktracker_innertxt(str)
{
  str = str.replace(/<[^>]*>/g, ' ');
  str = str.replace(  /&amp;/g, '&');
  str = str.replace( /&nbsp;/g, ' ');
  str = str.replace(   /^\s+/g,  '');
  str = str.replace(   /\s+$/g,  '');
  return str;
}


// ***** URL *******************************************************************

var clicktracker_re_scheme = "^\\w+://";
var clicktracker_re_folder = "((?:-|\\w|\\.)*)";
var clicktracker_re_domain = clicktracker_re_scheme+       clicktracker_re_folder;
var clicktracker_re_urlall = clicktracker_re_domain+"(?:/"+clicktracker_re_folder+')*';

// ***** clicktracker_domain *****

function clicktracker_domain(url)
{
  var reg   = new RegExp(clicktracker_re_domain);
  var match = reg.exec(url);
  if (!match) return "";
  match = match[match.length-1];
  return match;
}

// ***** clicktracker_extension *****

function clicktracker_extension(url)
{
  var reg   = new RegExp(clicktracker_re_urlall);
  var match = reg.exec(url);
  if (!match) return "";
  match = match[match.length-1].split(".");
  return (match.length >= 2) ? match[match.length-1] : "";
}


// ***** Track *****************************************************************

// ***** clicktracker_aux *****

function clicktracker_aux(url, title)
{
  var img = new Image();
  img.src = clicktracker_url+"?url="+url+"&title="+title+"&rand="+Math.random();
}

// ***** clicktracker *****

function clicktracker(e)
{
  var ie  = navigator.appName == "Microsoft Internet Explorer";
  var src = ie ? window.event.srcElement : e.target;
  var tag =  (src.tagName.toLowerCase() != "a") ? src.parentNode : src;

  if (!tag || tag.tagName.toLowerCase() != "a") return;

  domain    = clicktracker_domain   (tag.href);
  extension = clicktracker_extension(tag.href);

  if ( clicktracker_inarray(clicktracker_domains, domain) &&
      !clicktracker_inarray(clicktracker_extensions, extension)) return;

  var url   = tag.href;
  var title = '';

  if (!title) if (tag.tagName.toLowerCase() ==   "a") title = clicktracker_innertxt(tag.innerHTML);
  if (!title) if (tag.tagName.toLowerCase() ==   "a") title = clicktracker_innertxt(tag.title);
  if (!title) if (src.tagName.toLowerCase() == "img") title = clicktracker_innertxt(src.alt);
  if (!title) if (src.tagName.toLowerCase() == "img") title = clicktracker_innertxt("Image");
  url   = escape(url  .substr(0, 150));
  title = escape(title.substr(0, 150));

  if (url && title) setTimeout("clicktracker_aux('"+url+"', '"+title+"')", 10);
  return;
}


// ***** Attach Events *********************************************************

if (navigator.appName == "Microsoft Internet Explorer")
     document.attachEvent   ('onclick', clicktracker);
else document.addEventListener('click', clicktracker, false);