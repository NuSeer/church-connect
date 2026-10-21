// Member photos: private storage, generic pictures when there is no (shared) photo.
export const BUCKET = 'member-photos';
const GENERIC = {female: 'avatar-woman.svg', male: 'avatar-man.svg'}, NEUTRAL = 'avatar-neutral.svg';

// Short-lived links for photos the signed-in person is allowed to see (the database decides who that is).
export async function signedUrls(db, paths) {
  const out = new Map(), list = [...new Set((paths || []).filter(Boolean))];
  if (!db || !list.length) return out;
  try {
    const {data} = await db.storage.from(BUCKET).createSignedUrls(list, 3600);
    for (const r of data || []) if (r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  } catch (e) { /* no photo links: generic pictures are shown instead */ }
  return out;
}

// A round picture: the real photo when allowed and available, otherwise the generic woman / man / neutral picture.
export function avatarEl(person, urls, size = 44, showPhoto = true) {
  const span = document.createElement('span'); span.className = 'avatar'; span.style.setProperty('--avatar', size + 'px');
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
  const fallback = GENERIC[person && person.gender] || NEUTRAL;
  const url = showPhoto && person && person.photo_path && urls ? urls.get(person.photo_path) : null;
  img.src = url || fallback; img.onerror = () => { img.onerror = null; img.src = fallback };
  span.append(img); return span;
}

// Centre-crop to a square and shrink, so phone pictures upload fast and use little storage.
export async function compressImage(file, max = 480, quality = 0.82) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Please choose a picture (JPG, PNG or WebP).');
  if (file.size > 20 * 1024 * 1024) throw new Error('That picture is too large. Please choose a smaller one.');
  let bmp;
  try { bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}) }
  catch (e) { throw new Error('That picture could not be read. Please try a JPG or PNG.') }
  const side = Math.min(bmp.width, bmp.height), out = Math.min(max, side);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = out;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not prepare the picture.')), 'image/jpeg', quality));
}

export async function uploadPhoto(db, path, file) {
  const blob = await compressImage(file);
  const {error} = await db.storage.from(BUCKET).upload(path, blob, {upsert: true, contentType: 'image/jpeg', cacheControl: '3600'});
  if (error) throw error;
  return path;
}
export async function removePhotoFile(db, path) {
  const {error} = await db.storage.from(BUCKET).remove([path]); if (error) throw error;
}
