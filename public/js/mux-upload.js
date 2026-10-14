// Sending a video file from this computer straight to Mux, in pieces (a 2-hour service can be a
// few gigabytes), so a dropped connection only repeats one piece. onProgress(0…1).
const PIECE = 64 * 1024 * 1024; // a multiple of 256 KB, as Mux's upload addresses need

function putPiece(url, blob, start, total, onLoaded) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Range', `bytes ${start}-${start + blob.size - 1}/${total}`);
    x.upload.onprogress = (e) => onLoaded(e.loaded);
    x.onload = () => resolve(x.status);
    x.onerror = () => reject(new Error('The connection dropped.'));
    x.send(blob);
  });
}

export async function uploadToMux(url, file, onProgress = () => {}) {
  for (let start = 0; start < file.size; start += PIECE) {
    const blob = file.slice(start, Math.min(file.size, start + PIECE));
    for (let tries = 1; ; tries++) {
      try {
        const status = await putPiece(url, blob, start, file.size, (n) => onProgress((start + n) / file.size));
        // 308: piece received, send the next one; 200/201: the whole file is there.
        if ([200, 201, 308].includes(status)) break;
        throw new Error(`Mux didn’t take the file (${status}).`);
      } catch (e) {
        if (tries >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000 * tries));
      }
    }
  }
  onProgress(1);
}

// "Mission Possible - VICTORY | Pastor Lee Endris.mp4" and the title on YouTube, compared loosely.
export const looseTitle = (s) => String(s || '').replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
