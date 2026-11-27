// One video's address (#/media/12): the Library with that video open in its side panel, so old
// links, search results and "Add a video" all land in the same place.
import media from './media.js';

export default (el, id) => media(el, 'library', { open: Number(id) });
