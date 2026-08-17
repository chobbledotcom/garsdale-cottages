import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const placesDir = join(here, "..", "places");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Fallback map category by frontmatter `category:` value
const CATEGORY_BY_TYPE = {
  Activity: "entertainment_and_activities",
  Attraction: "sightseeing",
  Cafe: "coffee_shop",
  Cave: "entertainment_and_activities",
  Castle: "castle",
  Garden: "scenic_gardens",
  Museum: "museums",
  Pub: "gastro_pub",
  Restaurant: "restaurants",
  Service: "other",
  Shop: "retail_therapy",
  Station: "train",
  Waterfall: "parks_and_nature",
};

// Per-slug overrides: services and walk/area pages with a more specific category
const CATEGORY_BY_SLUG = {
  "bainbridge-vets-askrigg": "vet",
  "farm-gate-vets-hawes": "vet",
  "central-dales-pharmacy-hawes": "pharmacy",
  "jhoots-pharmacy-sedbergh": "pharmacy",
  "dt-close-sedbergh": "gas_station",
  "dalehead-garage-hawes": "gas_station",
  "on-time-taxis-sedbergh": "taxi",
  "westmorland-general-hospital-kendal": "medical_facilities",
  "royal-lancaster-infirmary-lancaster": "medical_facilities",
  "sedbergh-post-office": "bank",
  "barclays-atm-hawes": "bank",
  "natwest-atm-sedbergh": "bank",
  "joss-lane-car-park-sedbergh": "parking",
  "vodafone": "retail_therapy",
  "sedbergh-tourist-information": "tourist_information",
  "sedbergh-school-swimming-pool": "swimming",
  "kendal-leisure-centre": "fitness_exercise",
  "cumbrian-heavy-horses": "horse_riding",
  "dales-bike-centre": "bike_rental",
  "sedbergh-golf-club": "golfing",
  "sedbergh-market": "farm_shop_market",
  "the-market-house-hawes": "events",
  "morecambe-beach": "beaches",
  "howgill-fells": "hiking",
  ingleborough: "hiking",
  "crackpot-hall-and-upper-swaledale": "hiking",
  "keld-to-tan-hill-inn": "hiking",
  "malham-tarn": "nature_reserve",
  "smardale-gill-nature-reserve": "nature_reserve",
  "snaizeholme-red-squirrel-trail": "nature_reserve",
  "sedbergh-pizza": "take_out",
  "the-chippie": "take_out",
  "the-haddock-paddock": "take_out",
  "water-lily-chinese-kirkby-lonsdale": "take_out",
  "spice-essence-indian-cuisine": "take_out",
  "spar-hawes": "grocery_shopping",
  "spar-sedbergh": "grocery_shopping",
  "powells-sedbergh": "grocery_shopping",
  "the-meat-hook-sedbergh": "grocery_shopping",
  "wensleydale-creamery-hawes": "souvenirs",
  "farfield-mill-sedbergh": "arts_and_culture",
};

// Coordinates for places without a Google listing (carried from previous map data)
const LOCATION_BY_SLUG = {
  "barclays-atm-hawes": { lat: 54.3041047, lng: -2.1977889 },
  "natwest-atm-sedbergh": { lat: 54.3238335, lng: -2.526768 },
  "market-square-kirkby-lonsdale": { lat: 54.2019454, lng: -2.5966415 },
};

const CATEGORIES = [
  { type: "adventure_activities", label: "Adventure activities", iconify: "hugeicons:mountain", color: "#E65100" },
  { type: "arts_and_culture", label: "Arts and culture", iconify: "hugeicons:mask-theater-01", color: "#6A1B9A" },
  { type: "bank", label: "Bank and cash machines", iconify: "hugeicons:bank", color: "#2E7D32" },
  { type: "beaches", label: "Beaches", iconify: "hugeicons:beach-02", color: "#0288D1" },
  { type: "bike_rental", label: "Bike rentals", iconify: "hugeicons:bicycle", color: "#E65100" },
  { type: "castle", label: "Castles", iconify: "hugeicons:location-04", color: "#757575" },
  { type: "coffee_shop", label: "Coffee shops and cafes", iconify: "hugeicons:coffee-02", color: "#6D4C41" },
  { type: "entertainment_and_activities", label: "Entertainment and activities", iconify: "hugeicons:stars", color: "#8E24AA" },
  { type: "events", label: "Markets and events", iconify: "hugeicons:calendar-03", color: "#D81B60" },
  { type: "farm_shop_market", label: "Farm shop/farmers market", iconify: "hugeicons:organic-food", color: "#558B2F" },
  { type: "fitness_exercise", label: "Fitness/exercise", iconify: "hugeicons:dumbbell-03", color: "#EF6C00" },
  { type: "gas_station", label: "Gas/petrol station", iconify: "hugeicons:gas-pipe", color: "#546E7A" },
  { type: "gastro_pub", label: "Pubs", iconify: "hugeicons:restaurant-03", color: "#C62828" },
  { type: "golfing", label: "Golfing", iconify: "hugeicons:location-04", color: "#757575" },
  { type: "grocery_shopping", label: "Grocery shopping", iconify: "hugeicons:shopping-cart-01", color: "#1565C0" },
  { type: "hiking", label: "Walks and fells", iconify: "hugeicons:mountain", color: "#2E7D32" },
  { type: "horse_riding", label: "Horse riding", iconify: "hugeicons:tree-06", color: "#4E342E" },
  { type: "medical_facilities", label: "Medical facilities", iconify: "hugeicons:hospital-02", color: "#B71C1C" },
  { type: "museums", label: "Museums", iconify: "hugeicons:building-03", color: "#5E35B1" },
  { type: "nature_reserve", label: "Nature reserves", iconify: "hugeicons:tree-01", color: "#1B5E20" },
  { type: "other", label: "Other", iconify: "hugeicons:location-04", color: "#757575" },
  { type: "parks_and_nature", label: "Waterfalls and nature", iconify: "hugeicons:tree-01", color: "#2E7D32" },
  { type: "parking", label: "Parking", iconify: "hugeicons:parking-area-circle", color: "#1565C0" },
  { type: "pharmacy", label: "Pharmacy", iconify: "hugeicons:medicine-02", color: "#00838F" },
  { type: "restaurants", label: "Restaurants", iconify: "hugeicons:restaurant-03", color: "#C62828" },
  { type: "retail_therapy", label: "Retail shops/stores", iconify: "hugeicons:shopping-bag-02", color: "#AD1457" },
  { type: "sightseeing", label: "Sightseeing", iconify: "hugeicons:binoculars", color: "#00695C" },
  { type: "souvenirs", label: "Souvenirs", iconify: "hugeicons:gift", color: "#F4511E" },
  { type: "swimming", label: "Swimming", iconify: "hugeicons:swimming", color: "#0277BD" },
  { type: "take_out", label: "Take out/away", iconify: "hugeicons:restaurant-01", color: "#FF8F00" },
  { type: "taxi", label: "Taxis", iconify: "hugeicons:taxi", color: "#F9A825" },
  { type: "tourist_information", label: "Tourist information", iconify: "hugeicons:information-circle", color: "#0D47A1" },
  { type: "train", label: "Train stations", iconify: "hugeicons:train-01", color: "#283593" },
  { type: "vet", label: "Vets", iconify: "hugeicons:bone-01", color: "#5D4037" },
];

const readPlaceFile = (file) => {
  const text = readFileSync(join(placesDir, file), "utf8");
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return {};
  try {
    return Bun.YAML.parse(m[1]) ?? {};
  } catch {
    return {};
  }
};

const loadMapPlaces = () => {
  const places = [];
  if (!existsSync(placesDir)) return { places, categories: CATEGORIES };

  for (const file of readdirSync(placesDir)) {
    if (!file.endsWith(".md")) continue;
    const slug = basename(file, ".md");
    const data = readPlaceFile(file);

    const location = data.google?.location ?? LOCATION_BY_SLUG[slug];
    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") continue;

    const category =
      CATEGORY_BY_SLUG[slug] ?? CATEGORY_BY_TYPE[data.category] ?? "other";

    const place = {
      title: data.name ?? slug,
      category,
      location: { lat: location.lat, lng: location.lng },
      url: `/places/${slug}/`,
    };

    if (data.meta_description) place.description = data.meta_description;
    if (data.google?.permanently_closed) place.closed = "permanent";
    else if (data.google?.temporarily_closed) place.closed = "temporary";

    places.push(place);
  }

  places.sort((a, b) => a.title.localeCompare(b.title));
  return { places, categories: CATEGORIES };
};

export default loadMapPlaces();
