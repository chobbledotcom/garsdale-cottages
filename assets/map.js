(function () {
  var dataEl = document.getElementById("map-places-data");
  var data = JSON.parse(dataEl.textContent);
  var places = data.places;
  var categories = data.categories;

  var catLookup = {};
  var catIconLookup = {};
  categories.forEach(function (c) {
    catLookup[c.type] = c.label;
    catIconLookup[c.type] = { iconify: c.iconify, color: c.color };
  });

  var usedCategories = [];
  var seen = {};
  places.forEach(function (p) {
    if (!seen[p.category]) {
      seen[p.category] = true;
      usedCategories.push({
        type: p.category,
        label: catLookup[p.category] || p.category,
        color: (catIconLookup[p.category] || {}).color || "#757575"
      });
    }
  });
  usedCategories.sort(function (a, b) {
    return a.label.localeCompare(b.label);
  });

  // Build icon SVG lookup from build-time rendered templates
  var iconSvgLookup = {};
  document.querySelectorAll("#map-icons template[data-icon]").forEach(function (t) {
    iconSvgLookup[t.dataset.icon] = t.innerHTML.trim();
  });

  var filtersEl = document.getElementById("map-filters");
  usedCategories.forEach(function (cat) {
    var btn = document.createElement("button");
    var iconify = (catIconLookup[cat.type] || {}).iconify;
    if (iconify && iconSvgLookup[iconify]) {
      var iconSpan = document.createElement("span");
      iconSpan.className = "filter-icon";
      iconSpan.style.color = cat.color;
      iconSpan.innerHTML = iconSvgLookup[iconify];
      btn.appendChild(iconSpan);
    } else {
      var dot = document.createElement("span");
      dot.className = "filter-dot";
      dot.style.backgroundColor = cat.color;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(cat.label));
    btn.dataset.category = cat.type;
    filtersEl.appendChild(btn);
  });

  var latSum = 0;
  var lngSum = 0;
  places.forEach(function (p) {
    latSum += p.location.lat;
    lngSum += p.location.lng;
  });
  var centreLat = latSum / places.length;
  var centreLng = lngSum / places.length;

  var map = L.map("map").setView([centreLat, centreLng], 11);

  var osmLink = document.createElement("a");
  osmLink.href = "https://www.openstreetmap.org/copyright";
  osmLink.textContent = "OpenStreetMap";
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "\u00A9 " + osmLink.outerHTML + " contributors",
    maxZoom: 19
  }).addTo(map);

  var properties = [
    { name: "The Old Cart House", lat: 54.301567363302105, lng: -2.3884263433724717 },
    { name: "Roger Pot", lat: 54.30236605935729, lng: -2.3889289241208953 }
  ];

  var propertyIcon = L.divIcon({
    className: "property-marker-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8]
  });

  var propLatSum = 0;
  var propLngSum = 0;
  properties.forEach(function (p) {
    propLatSum += p.lat;
    propLngSum += p.lng;
  });
  var garsdaleLat = propLatSum / properties.length;
  var garsdaleLng = propLngSum / properties.length;

  properties.forEach(function (prop) {
    var marker = L.marker([prop.lat, prop.lng], { icon: propertyIcon });
    var popupEl = document.createElement("div");
    popupEl.className = "place-popup";
    var h3 = document.createElement("h3");
    h3.textContent = prop.name;
    popupEl.appendChild(h3);
    var catP = document.createElement("p");
    catP.className = "category";
    catP.textContent = "Our property";
    popupEl.appendChild(catP);
    marker.bindPopup(popupEl);
    marker.addTo(map);
  });

  function createCategoryIcon(color, iconifyId) {
    var name = iconifyId || "hugeicons:location-04";
    var svgHtml = iconSvgLookup[name] || "";
    var el = document.createElement("div");
    el.className = "category-marker-icon";
    el.style.background = color;
    el.innerHTML = svgHtml;
    return L.divIcon({
      className: "",
      html: el,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });
  }

  var markers = [];
  places.forEach(function (place) {
    var catInfo = catIconLookup[place.category] || {};
    var color = catInfo.color || "#757575";
    var iconifyId = catInfo.iconify || "hugeicons:location-04";
    var icon = createCategoryIcon(color, iconifyId);
    var marker = L.marker([place.location.lat, place.location.lng], { icon: icon });

    var popupEl = document.createElement("div");
    popupEl.className = "place-popup";

    var h3 = document.createElement("h3");
    h3.textContent = place.title;
    popupEl.appendChild(h3);

    var catP = document.createElement("p");
    catP.className = "category";
    catP.textContent = catLookup[place.category] || place.category;
    popupEl.appendChild(catP);

    if (place.closed === "permanent" || place.closed === "temporary") {
      var closedP = document.createElement("p");
      closedP.className = "closed-note";
      closedP.textContent =
        place.closed === "permanent"
          ? "Currently listed as permanently closed"
          : "Currently listed as temporarily closed";
      popupEl.appendChild(closedP);
    }

    if (place.description) {
      var tmp = document.createElement("div");
      tmp.innerHTML = place.description;
      var text = tmp.textContent.trim();
      if (text) {
        var descDiv = document.createElement("div");
        descDiv.className = "description";
        descDiv.textContent = text;
        popupEl.appendChild(descDiv);
      }
    }

    if (place.url) {
      var pageLink = document.createElement("a");
      pageLink.textContent = "Read more";
      pageLink.href = place.url;
      pageLink.className = "page-link";
      popupEl.appendChild(pageLink);
    }

    var dirLink = document.createElement("a");
    dirLink.textContent = "Directions from Garsdale";
    dirLink.href = "https://www.google.com/maps/dir/" + garsdaleLat + "," + garsdaleLng + "/" + place.location.lat + "," + place.location.lng;
    dirLink.target = "_blank";
    dirLink.rel = "noopener";
    dirLink.className = "directions-link";
    popupEl.appendChild(dirLink);

    if (place.w3w) {
      var w3wLink = document.createElement("a");
      w3wLink.textContent = "///" + place.w3w;
      w3wLink.href = "https://what3words.com/" + place.w3w;
      w3wLink.target = "_blank";
      w3wLink.rel = "noopener";
      w3wLink.className = "w3w-link";
      popupEl.appendChild(w3wLink);
    }

    marker.bindPopup(popupEl);
    marker.addTo(map);
    markers.push({ marker: marker, category: place.category });
  });

  var activeCategory = "all";

  filtersEl.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;

    // Toggle: clicking the already-active category deselects it (back to "all")
    if (btn.dataset.category === activeCategory && activeCategory !== "all") {
      activeCategory = "all";
    } else {
      activeCategory = btn.dataset.category;
    }

    filtersEl.querySelectorAll("button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.category === activeCategory);
    });

    var visibleLatLngs = [];

    markers.forEach(function (item) {
      if (activeCategory === "all" || item.category === activeCategory) {
        item.marker.addTo(map);
        visibleLatLngs.push(item.marker.getLatLng());
      } else {
        map.removeLayer(item.marker);
      }
    });

    if (visibleLatLngs.length > 0) {
      var bounds = L.latLngBounds(visibleLatLngs);
      if (!map.getBounds().contains(bounds)) {
        map.setView([centreLat, centreLng], 11);
        if (!map.getBounds().contains(bounds)) {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      }
    }
  });
})();
