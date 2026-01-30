import { computeGallery } from "#collections/products.js";
import strings from "#data/strings.js";
import { buildPermalink } from "#utils/slug-utils.js";

export default {
	eleventyComputed: {
		gallery: computeGallery,
		navigationParent: () => strings.activities_name,
		permalink: (data) => buildPermalink(data, strings.activities_permalink_dir),
	},
};
