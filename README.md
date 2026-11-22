# Chobble Client Site Builder

Quick static site generator that combines the [Chobble Template](https://git.chobble.com/chobble/chobble-template/) with your content.

## Quick Start

1. **Add your content** - Edit markdown files and images in the relevant folders
2. **Push to GitHub** - The site builds automatically via GitHub Actions
3. **Deploy happens automatically** - Site deploys to Neocities (or your chosen host)

## What Goes Where

The `.pages.yml` defines all your content types:
- `pages/` - Static pages with navigation
- `news/` - Blog posts with dates
- `products/` - Shop items with prices and Etsy links
- `categories/` - Product categories
- `team/` - Team member profiles
- `reviews/` - Customer testimonials
- `events/` - Upcoming events
- `menus/`, `menu-categories/`, `menu-items/` - Restaurant menu system
- `snippets/` - Reusable content bits
- `images/` - All your images

## How It Works

When you push to GitHub:
1. GitHub Actions merges your content with the template
2. Builds the static site with Eleventy
3. Deploys to your configured hosting (Neocities by default)

## Configuration

Set these GitHub secrets for your repo:
- `NEOCITIES_API_KEY` - For deployment
- `FORMSPARK_ID` - For contact forms (optional)
- `BOTPOISON_PUBLIC_KEY` - For spam protection (optional)

## Local Development

Run `bun run build` to build locally. The output appears in `_site/`.

## Local Area and Footer

The local area map is at `/places/`; `/map/` redirects there through
`redirect_from` in `pages/places.md`. Regional guides are at
`/places/lake-district/` and `/places/cumbria/`, with the motorway stopover guide
at `/20-minutes-from-the-m6/`. Garsdale is in the Yorkshire Dales, not the Lake
District.
The Lake District page and homepage card use Paul and Karen's photograph of
Helms Knott from Gawthrop, with the Dales location made explicit on the page,
rather than a photograph from the Google Maps importer.

Footer links and owner information live in `snippets/footer-content.md`.
`_includes/footer.html` renders the latest four locally cached Facebook posts;
the cards do not embed Facebook scripts or load images from its servers.
Run `bun run fetch-facebook-posts` with `APIFY_API_KEY` in `.env` to refresh
`social-posts/` and `images/facebook-posts/`. The scheduled workflow uses the
same repository secret and dispatches a build after committing new posts.
Rebuild after a local import.

The Roger Pot exterior photograph is 1200 × 900 pixels, enlarged without AI
using ImageMagick's Lanczos filter in linear RGB. Section contour artwork is
in `assets/dales-contours.svg`; its presentation and the footer styles are in
`css/theme.scss`.

## Reviews

Reviews are markdown files in `reviews/`, linked to a property through the
`property` frontmatter field. The scrapers read listing identifiers from each
property file:

- `google_place_id` for Google Maps reviews
- `booking_url` for Booking.com reviews
- `airbnb_url` for Airbnb reviews
- `freetobook_id` and `freetobook_token` for Freetobook reviews

Run `bun run fetch-google-reviews` for Google, or
`bun run fetch-platform-reviews` for Booking.com, Airbnb and Freetobook. Each
individual platform also has its own script: `fetch-booking-reviews`,
`fetch-airbnb-reviews` and `fetch-freetobook-reviews`.