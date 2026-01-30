import { computeGallery } from "#collections/products.js";
import { linkableContent } from "#utils/linkable-content.js";

export default linkableContent("walks", {
	gallery: computeGallery,
});
