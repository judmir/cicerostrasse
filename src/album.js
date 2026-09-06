// Keep navigation anchored to the photo ID when uploads or edits change an album.
export function createAlbum() {
  let photos = [];
  let index = -1;
  return {
    get photos() { return photos; },
    get current() { return photos[index] || null; },
    get index() { return index; },
    get length() { return photos.length; },
    get hasPrevious() { return index > 0; },
    get hasNext() { return index >= 0 && index < photos.length - 1; },
    setPhotos(items) {
      const previousId = photos[index]?.id;
      const previousIndex = index;
      photos = [...items];
      const retained = photos.findIndex((photo) => photo.id === previousId);
      index = retained >= 0 ? retained : Math.min(Math.max(previousIndex, 0), photos.length - 1);
      return this.current;
    },
    select(id) {
      const next = photos.findIndex((photo) => photo.id === id);
      if (next < 0) return false;
      index = next;
      return true;
    },
    move(offset) {
      if (!photos.length) return null;
      index = Math.max(0, Math.min(photos.length - 1, index + offset));
      return this.current;
    },
    thumbnails(limit = 11) {
      const start = Math.max(0, Math.min(index - Math.floor(limit / 2), photos.length - limit));
      return photos.slice(start, start + limit).map((photo, offset) => ({ photo, index: start + offset }));
    },
  };
}
