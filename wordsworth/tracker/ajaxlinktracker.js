/*
Ajax Link Tracker, version 2.2

Copyright (c) 2006 Glenn Jones

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

You must give the original author attribution. For any reuse or
distribution, you must make clear to others the licence terms of this
work.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/


function AjaxLinkTracker() {

    var me;
    if (this.constructor == AjaxLinkTracker){
        me = this;
    }else{
        me = arguments[arguments.length-1];
    }

	// Configuration
	// ------------
	me.apiURL = 'http://www.wordsworthcountry.com/tracker/';
	me.displayCount = false;
	me.displayPercent = true;
	me.displayLabel = true;
	me.numberDays = 28; //1-30
	me.clickOffSet = 10;
	// -----------

	me.url = encodeURIComponent( document.location.href );
	me.listeners = [];
	
	
	me.addLinkTracking = function(){
		if (!document.getElementsByTagName) return false;
	
		// Create ajax objects
		me.clickedXHR = new XHRConnection();
		me.getClicksXHR = new XHRConnection();
		
		// find links in document 
		links = document.getElementsByTagName('a');
	
		// if link does have a id add one
		for (var i = 0; i < links.length; i++) {
			me.addEvent( links[i], 'mousedown', me.recordClick, false );
			me.addEvent( links[i], 'keypress', me.linkKeyPress, false );
			if (! links[i].getAttribute('id') ) {
				links[i].setAttribute('id','link_' + i);
			}
		}
		
		// find buttons in document
		inputs = document.getElementsByTagName('input');
		for (var i = 0; i < inputs.length; i++) {
		
			type = inputs[i].getAttribute('type');
			
			// only attach events to buttons
			if ( type == 'submit' || type == 'button' ){
				me.addEvent( inputs[i], 'mousedown', me.recordClick, false );
				me.addEvent( inputs[i], 'keypress', me.linkKeyPress, false );
				// if button does have a id add one
				if (! inputs[i].getAttribute('id') ){
					inputs[i].setAttribute('id','button_' + i);
				}	
			}
		}
	}
	
	me.linkKeyPress = function(e) {
		// check for return key press
		var keyID = (window.event) ? event.keyCode : e.keyCode;
		if (keyID == 13) {
			me.recordClick(e);
		}
	}

	me.recordClick = function(e) {
		// records click information using ajax
		source = me.findSourceElement(e);
		tag = source.tagName;
		var id,label,target
		
		if( tag == 'IMG'){
			if( source.parentNode.tagName == 'A' )
			{
				id = source.parentNode.getAttribute('id');
				target = source.parentNode.href;
			}
			label = source.getAttribute('alt');
			if (label == null) {
				label = 'image';
			}
		}
		
		if( tag == 'A' ){
			id = source.getAttribute('id');
			target = source.href;
			label = me.getInnerText( source, '' );
		}	
				
		if( tag == 'INPUT' ){
			id = source.getAttribute('id');
			label = source.getAttribute('value');

			if( source.getAttribute('type') == 'submit' ) {
				target = me.getFormTarget( source );
			} else {
				target = 'script';
			}
		}
		
		
		id = encodeURIComponent( id );
		target = encodeURIComponent( target );
		label = encodeURIComponent( label );
			
		var ajaxURL = me.apiURL + 'addclick.php?id=' + id + '&label=' + label + '&target=' + target + '&url=' + me.url + '&rand='+Math.random();
		me.clickedXHR.send( ajaxURL, 'get', me.beenClicked, null  );
		
	}
	
	
	me.beenClicked = function( obj ) {
		//alert( obj.responseText );
	}
	
	
	me.getClickThroughInfo = function (){
		// get click data using ajax
		var ajaxURL = me.apiURL + 'getclicks.php?url=' + me.url + '&days=' + me.numberDays + '&rand='+Math.random();
		me.getClicksXHR.send( ajaxURL, 'get', me.displayClickThroughs, null  );
	}	


	me.displayClickThroughs = function( obj ){
		// display click through data
	
		if (!document.getElementsByTagName) return false;
		
		if(obj.responseXML)
			node = obj.responseXML;
		if(obj.responseXml)
			node = obj.responseXML;	
			
		if(node.childNodes[0].nodeType == 7) {
			rootNode = node.childNodes[1];
		}else{
			rootNode = node.childNodes[0];
		}

		for (var i = 0; i < rootNode.childNodes.length; i++) {
		
			linknode = rootNode.childNodes[i];
			count = linknode.getAttribute('count');
			percent = linknode.getAttribute('percent');
			label = linknode.getAttribute('label');
			id = linknode.childNodes[0].nodeValue;
			
			if ( document.getElementById(id) ) {
			
				eltLink =  document.getElementById(id);
				
				eltDiv = document.createElement( 'div' );
				eltDiv.className = 'linklabel';
				
				var text = ''; 
				if( me.displayPercent )
					text += percent + '% ';
				
				if( me.displayCount )
					text += '(' + count + ') ';
					
				if( me.displayLabel )
					text += label ;
				
				eltText = document.createTextNode( text );
				eltDiv.appendChild( eltText );
				document.body.appendChild( eltDiv );
				
				Drag.init(eltDiv, eltDiv);
				
				ileft = parseInt( me.getPageOffsetLeft( eltLink ) ) + me.clickOffSet;
				itop = parseInt( me.getPageOffsetTop( eltLink ) ) + me.clickOffSet;
				eltDiv.style.left = ileft + 'px';
				eltDiv.style.top = itop + 'px';
				
			}
		} 
		me.labelsCreated = true;
		me.labelsDisplayed = true;

	}
	
	me.keyCheck = function (e) {
		// check to see if user press 'ctrl x'
		var keyID = (window.event) ? event.keyCode : e.keyCode;
		var ctrlKey = (window.event) ? event.ctrlKey : e.ctrlKey;
		
		if((keyID == 88)&&(ctrlKey == true)) { 
			
			eltLabels = me.getElementsByClassName('linklabel');
			if( eltLabels.length == 0 ) {
				me.getClickThroughInfo();
			}else{
				for (var i = 0; i < eltLabels.length; i++) {
					eltLabels[i].parentNode.removeChild(eltLabels[i]);
				}
			}
		}
	}
	
	me.getInnerText = function( node, text ) {
		// returns the text of any element node
		for (var i = 0; i < node.childNodes.length; i++) {
		
			if( node.childNodes[i].nodeType == 3 ) {
				text += node.childNodes[i].nodeValue;
			}	
			if( node.childNodes[i].nodeType == 1 ) {
				text = me.getInnerText( node.childNodes[i], text);
			}
		}
		return text;
	}
	
	me.getFormTarget = function( elt ) {
		// returns the form action attribute from 
		// if given the child node of that form
		target = null;
		parentElt = elt.parentNode;
		if( parentElt.nodeType == 1 ) {
			if( parentElt.tagName == 'FORM' ) {
				target = parentElt.getAttribute('action');
			}else {
				target = me.getFormTarget( elt.parentNode );
			}
		}else {
			target = me.getFormTarget( elt.parentNode );
		}
		return target;
	}
	
	me.addEvent = function( elm, evType, fn, useCapture ) {
		// Updated version which captures passed events 
		if (elm.AddEventListener) 
		{ 
			elm.AddEventListener(evType, fn, useCapture); 
			return true; 
		} else if (elm.attachEvent) { 
			var r = elm.attachEvent('on' + evType, fn);
			me.listeners[me.listeners.length] = [ elm, evType, fn ];
			return r; 
		} else {
			var xEventFn = elm['on' + evType];
			if (typeof elm['on' + evType] != 'function') 
			{
				elm['on' + evType] = fn;
			} else {
				elm['on' + evType] = function(e) { xEventFn(e); fn(e); };
			}
		}
	}
	
	me.unload = function(){
		// page unload event which removes circular references
		// that may cause memory leaks in IE 5/6
		if( window.attachEvent ){
			for (var i = 0; i < me.listeners.length; i++) {
				me.listeners[i][0].detachEvent( 'on' + me.listeners[i][1], me.listeners[i][2] );
			}
		}
	}
	
	me.getElementsByClassName = function( className ) {
		// returns a collection of element nodes which 
		// have the passed className
		var children = document.getElementsByTagName('*') || document.all;
		var elements = new Array();
		for (var i = 0; i < children.length; i++) 
		{
			var child = children[i];
			var classNames = child.className.split(' ');
			for (var j = 0; j < classNames.length; j++) 
			{
				if (classNames[j] == className) 
				{
					elements.push(child);
					break;
				}
			}
		}
		return elements;
	}
	
	me.findSourceElement = function(e) {
		// finds event source
		if (typeof e == 'undefined')
			var e = window.event;

		var source;
		if (typeof e.target != 'undefined') 
		{
			source = e.target;
		} else if (typeof e.srcElement != 'undefined') {
			source = e.srcElement;
		} else {
			return true;
		}

		if (source.nodeType == 3)
			source = source.parentNode;
		
		return source;
	}
	
	me.getPageOffsetLeft = function(elt) {
		var x;
		x = elt.offsetLeft;
		if (elt.offsetParent != null)
			x += me.getPageOffsetLeft(elt.offsetParent);
		return x;
	}
	
	me.getPageOffsetTop = function(elt) {
		var y;
		y = elt.offsetTop;
		if (elt.offsetParent != null)
			y += me.getPageOffsetTop(elt.offsetParent);
		return y;
	}
	
	//------------------------------------------


	// dom-drag.js
	// 09.25.2001
	// www.youngpup.net
	var Drag = {

		obj : null,

		init : function(o, oRoot, minX, maxX, minY, maxY, bSwapHorzRef, bSwapVertRef, fXMapper, fYMapper)
		{
			o.onmousedown = Drag.start;
			o.hmode = bSwapHorzRef ? false : true ;
			o.vmode = bSwapVertRef ? false : true ;

			o.root = oRoot && oRoot != null ? oRoot : o ;

			if (o.hmode  && isNaN(parseInt(o.root.style.left  ))) o.root.style.left   = '0px';
			if (o.vmode  && isNaN(parseInt(o.root.style.top   ))) o.root.style.top    = '0px';
			if (!o.hmode && isNaN(parseInt(o.root.style.right ))) o.root.style.right  = '0px';
			if (!o.vmode && isNaN(parseInt(o.root.style.bottom))) o.root.style.bottom = '0px';

			o.minX = typeof minX != 'undefined' ? minX : null;
			o.minY = typeof minY != 'undefined' ? minY : null;
			o.maxX = typeof maxX != 'undefined' ? maxX : null;
			o.maxY = typeof maxY != 'undefined' ? maxY : null;

			o.xMapper = fXMapper ? fXMapper : null;
			o.yMapper = fYMapper ? fYMapper : null;

			o.root.onDragStart = new Function();
			o.root.onDragEnd = new Function();
			o.root.onDrag = new Function();
		},

		start : function(e)
		{
			
			var o = Drag.obj = this;
			e = Drag.fixE(e);
			var y = parseInt(o.vmode ? o.root.style.top  : o.root.style.bottom);
			var x = parseInt(o.hmode ? o.root.style.left : o.root.style.right );
			o.root.onDragStart(x, y);

			o.lastMouseX = e.clientX;
			o.lastMouseY = e.clientY;

			if (o.hmode) {
				if (o.minX != null) o.minMouseX = e.clientX - x + o.minX;
				if (o.maxX != null) o.maxMouseX = o.minMouseX + o.maxX - o.minX;
			} else {
				if (o.minX != null) o.maxMouseX = -o.minX + e.clientX + x;
				if (o.maxX != null) o.minMouseX = -o.maxX + e.clientX + x;
			}

			if (o.vmode) {
				if (o.minY != null) o.minMouseY = e.clientY - y + o.minY;
				if (o.maxY != null) o.maxMouseY = o.minMouseY + o.maxY - o.minY;
			} else {
				if (o.minY != null) o.maxMouseY = -o.minY + e.clientY + y;
				if (o.maxY != null) o.minMouseY = -o.maxY + e.clientY + y;
			}

			document.onmousemove = Drag.drag;
			document.onmouseup = Drag.end;

			return false;
		},

		drag : function(e)
		{
			e = Drag.fixE(e);
			var o = Drag.obj;

			var ey = e.clientY;
			var ex = e.clientX;
			var y = parseInt(o.vmode ? o.root.style.top  : o.root.style.bottom);
			var x = parseInt(o.hmode ? o.root.style.left : o.root.style.right );
			var nx, ny;

			if (o.minX != null) ex = o.hmode ? Math.max(ex, o.minMouseX) : Math.min(ex, o.maxMouseX);
			if (o.maxX != null) ex = o.hmode ? Math.min(ex, o.maxMouseX) : Math.max(ex, o.minMouseX);
			if (o.minY != null) ey = o.vmode ? Math.max(ey, o.minMouseY) : Math.min(ey, o.maxMouseY);
			if (o.maxY != null) ey = o.vmode ? Math.min(ey, o.maxMouseY) : Math.max(ey, o.minMouseY);

			nx = x + ((ex - o.lastMouseX) * (o.hmode ? 1 : -1));
			ny = y + ((ey - o.lastMouseY) * (o.vmode ? 1 : -1));

			if (o.xMapper) nx = o.xMapper(y)
			else if (o.yMapper) ny = o.yMapper(x)

			Drag.obj.root.style[o.hmode ? 'left' : 'right'] = nx + 'px';
			Drag.obj.root.style[o.vmode ? 'top' : 'bottom'] = ny + 'px';
			Drag.obj.lastMouseX = ex;
			Drag.obj.lastMouseY = ey;

			Drag.obj.root.onDrag(nx, ny);
			return false;
		},

		end : function()
		{
			document.onmousemove = null;
			document.onmouseup   = null;
			Drag.obj.root.onDragEnd(    parseInt(Drag.obj.root.style[Drag.obj.hmode ? 'left' : 'right']), 
										parseInt(Drag.obj.root.style[Drag.obj.vmode ? 'top' : 'bottom']));
			Drag.obj = null;
		},

		fixE : function(e)
		{
			if (typeof e == 'undefined') e = window.event;
			if (typeof e.layerX == 'undefined') e.layerX = e.offsetX;
			if (typeof e.layerY == 'undefined') e.layerY = e.offsetY;
			return e;
		}
	};
	
	me.addEvent( window, 'load', me.addLinkTracking, false );
	me.addEvent( document, 'keydown', me.keyCheck, false );
	me.addEvent( window, 'unload', me.unload, false );

}

var ajaxLinkTracker = new AjaxLinkTracker();


function XHRConnection() { 
    var me;
    if (this.constructor == XHRConnection){
        me = this
    }else{
        me = arguments[arguments.length-1]
    }
    
	me.Request = me.createXHR();
	 
    me.handler = function () {
		if (me.Request.readyState == 4) {
			if (me.Request.status == 200) {
		
				me.processResponse();
			}
		}
	}
	
	me.send = function ( url, action, fnOK ) {
	    me.URL = url;
		me.Action = action;
		me.fnOK = fnOK;
		if( me.Request != null ){
			me.Request.open(me.Action, me.URL, true);
			me.Request.onreadystatechange = me.handler;
			me.Request.send(null);
		}else{
			alert('Could not load XHR object');
		}
	}
}

XHRConnection.prototype.createXHR = function() {
    try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch (e) {}
    try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch (e) {}
    try { return new XMLHttpRequest(); } catch(e) {}
    return null;
}

XHRConnection.prototype.processResponse = function () {
	this.fnOK(this.Request);
}




