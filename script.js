const DB_NAME = "onlineaudio";
const DB_VERSION = 1;
const STORE = "tracks";
const SETTINGS_KEY = "onlineaudio:settings";
const DEFAULT_ACCENT = [139, 92, 246];
const BAR_COUNT = 56;
const MAX_TAG_BYTES = 40 * 1024 * 1024;
const RECENT_LIMIT = 30;
const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|flac|m4a|aac|mp4|weba|webm)$/i;

const ICONS = {
  play: '<path d="M8 5v14l11-7z" />',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" />',
  volHigh: '<path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />',
  volLow: '<path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />',
  volMute: '<path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m22 9-6 6M16 9l6 6" />',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>',
  rowPlay: '<svg class="play-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>',
  remove: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>',
};

const $ = (selector) => document.querySelector(selector);

const els = {
  addBtn: $("#addBtn"),
  addLabel: $("#addLabel"),
  emptyAdd: $("#emptyAdd"),
  fileInput: $("#fileInput"),
  player: $("#player"),
  art: $("#art"),
  artImg: $("#artImg"),
  artFallback: $("#artFallback"),
  title: $("#title"),
  artist: $("#artist"),
  album: $("#album"),
  viz: $("#viz"),
  seek: $("#seek"),
  curTime: $("#curTime"),
  durTime: $("#durTime"),
  shuffleBtn: $("#shuffleBtn"),
  prevBtn: $("#prevBtn"),
  playBtn: $("#playBtn"),
  playIcon: $("#playIcon"),
  nextBtn: $("#nextBtn"),
  repeatBtn: $("#repeatBtn"),
  muteBtn: $("#muteBtn"),
  volIcon: $("#volIcon"),
  volume: $("#volume"),
  volLabel: $("#volLabel"),
  stats: $("#stats"),
  clearBtn: $("#clearBtn"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  countAll: $("#countAll"),
  countRecent: $("#countRecent"),
  search: $("#search"),
  list: $("#list"),
  emptyLibrary: $("#emptyLibrary"),
  emptyResults: $("#emptyResults"),
  emptyResultsTitle: $("#emptyResultsTitle"),
  emptyResultsText: $("#emptyResultsText"),
  dropzone: $("#dropzone"),
  confirmDialog: $("#confirmDialog"),
  toasts: $("#toasts"),
};

const audio = new Audio();
audio.preload = "metadata";

const state = {
  tracks: [],
  view: "all",
  query: "",
  currentId: null,
  queue: [],
  history: [],
  played: new Set(),
  shuffle: false,
  repeat: "off",
  playing: false,
  objectUrl: null,
  importing: false,
  dbReady: false,
  ctx: null,
  analyser: null,
  freq: null,
  glow: 0.12,
  accent: DEFAULT_ACCENT.slice(),
  accentTarget: DEFAULT_ACCENT.slice(),
  accentKey: "",
  levels: new Float32Array(BAR_COUNT),
  lastSecond: -1,
  fresh: new Set(),
};

const settings = loadSettings();

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      volume: typeof raw.volume === "number" ? Math.min(1, Math.max(0, raw.volume)) : 0.8,
      muted: Boolean(raw.muted),
      shuffle: Boolean(raw.shuffle),
      repeat: ["off", "all", "one"].includes(raw.repeat) ? raw.repeat : "off",
      last: typeof raw.last === "string" ? raw.last : null,
    };
  } catch {
    return { volume: 0.8, muted: false, shuffle: false, repeat: "off", last: null };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        volume: audio.volume,
        muted: audio.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        last: state.currentId,
      })
    );
  } catch {
    return;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTotal(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `${Math.max(minutes, seconds > 0 ? 1 : 0)} min`;
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function toast(message, kind = "info", duration = 4200) {
  while (els.toasts.children.length >= 3) els.toasts.firstChild.remove();
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 320);
  }, duration);
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database blocked"));
  });
  return dbPromise;
}

async function runStore(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

const dbGetAll = () => runStore("readonly", (store) => store.getAll());
const dbDelete = (id) => runStore("readwrite", (store) => store.delete(id));
const dbClear = () => runStore("readwrite", (store) => store.clear());

function dbPut(track) {
  const { coverUrl, ...record } = track;
  return runStore("readwrite", (store) => store.put(record));
}

async function readBytes(file, start, end) {
  const buffer = await file.slice(start, Math.min(end, file.size)).arrayBuffer();
  return new Uint8Array(buffer);
}

function decodeText(bytes, encoding) {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return "";
  }
}

const latin1 = (bytes) => decodeText(bytes, "windows-1252");

function ascii4(bytes, index) {
  return String.fromCharCode(bytes[index], bytes[index + 1], bytes[index + 2], bytes[index + 3]);
}

function be32(bytes, index) {
  return bytes[index] * 16777216 + (bytes[index + 1] << 16) + (bytes[index + 2] << 8) + bytes[index + 3];
}

function synchsafe(bytes, index) {
  return (bytes[index] << 21) | (bytes[index + 1] << 14) | (bytes[index + 2] << 7) | bytes[index + 3];
}

function sniffImage(data, fallback) {
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  if (data[0] === 0x47 && data[1] === 0x49) return "image/gif";
  if (data[0] === 0x52 && data[1] === 0x49) return "image/webp";
  return fallback || "image/jpeg";
}

function makeCover(data, mime) {
  if (!data || data.length < 16) return null;
  return { data, mime: sniffImage(data, mime) };
}

function id3Text(bytes) {
  if (!bytes.length) return "";
  const encoding = bytes[0];
  const body = bytes.subarray(1);
  let text;
  if (encoding === 0) text = latin1(body);
  else if (encoding === 1) text = body[0] === 0xfe && body[1] === 0xff ? decodeText(body, "utf-16be") : decodeText(body, "utf-16le");
  else if (encoding === 2) text = decodeText(body, "utf-16be");
  else text = decodeText(body, "utf-8");
  return text
    .split("\0")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function skipTerminated(bytes, position, encoding) {
  if (encoding === 1 || encoding === 2) {
    while (position + 1 < bytes.length && !(bytes[position] === 0 && bytes[position + 1] === 0)) position += 2;
    return position + 2;
  }
  while (position < bytes.length && bytes[position] !== 0) position++;
  return position + 1;
}

function parseApic(bytes, legacy) {
  const encoding = bytes[0];
  let position;
  let mime;
  if (legacy) {
    mime = latin1(bytes.subarray(1, 4)).toLowerCase() === "png" ? "image/png" : "image/jpeg";
    position = 4;
  } else {
    const end = skipTerminated(bytes, 1, 0);
    mime = latin1(bytes.subarray(1, end - 1)).toLowerCase();
    position = end;
  }
  position += 1;
  position = skipTerminated(bytes, position, encoding);
  return makeCover(bytes.subarray(position), mime);
}

function removeUnsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0) i++;
  }
  return out.subarray(0, length);
}

async function readId3v2(file) {
  const head = await readBytes(file, 0, 10);
  if (head.length < 10 || latin1(head.subarray(0, 3)) !== "ID3") return null;
  const version = head[3];
  const flags = head[5];
  if (version < 2 || version > 4) return null;
  const size = Math.min(synchsafe(head, 6), MAX_TAG_BYTES);
  let tag = await readBytes(file, 10, 10 + size);
  if (flags & 0x80) tag = removeUnsync(tag);
  let position = 0;
  if (flags & 0x40 && version >= 3) position = version === 4 ? synchsafe(tag, 0) : be32(tag, 0) + 4;
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  const out = { title: "", artist: "", album: "", cover: null };
  const names = version === 2 ? { title: "TT2", artist: "TP1", album: "TAL", cover: "PIC" } : { title: "TIT2", artist: "TPE1", album: "TALB", cover: "APIC" };
  while (position + headerLength <= tag.length) {
    if (tag[position] === 0) break;
    const id = latin1(tag.subarray(position, position + idLength));
    let frameSize;
    if (version === 2) frameSize = (tag[position + 3] << 16) | (tag[position + 4] << 8) | tag[position + 5];
    else if (version === 4) frameSize = synchsafe(tag, position + 4);
    else frameSize = be32(tag, position + 4);
    const start = position + headerLength;
    const end = start + frameSize;
    if (frameSize <= 0 || end > tag.length) break;
    let data = tag.subarray(start, end);
    if (version === 4 && tag[position + 9] & 1) data = data.subarray(4);
    if (id === names.title && !out.title) out.title = id3Text(data);
    else if (id === names.artist && !out.artist) out.artist = id3Text(data);
    else if (id === names.album && !out.album) out.album = id3Text(data);
    else if (id === names.cover && !out.cover) out.cover = parseApic(data, version === 2);
    position = end;
  }
  return out;
}

async function readId3v1(file) {
  if (file.size < 128) return null;
  const bytes = await readBytes(file, file.size - 128, file.size);
  if (latin1(bytes.subarray(0, 3)) !== "TAG") return null;
  const field = (start, end) => latin1(bytes.subarray(start, end)).split("\0")[0].trim();
  return { title: field(3, 33), artist: field(33, 63), album: field(63, 93), cover: null };
}

function walkBoxes(bytes, start, end, visit) {
  let position = start;
  while (position + 8 <= end) {
    let size = be32(bytes, position);
    const type = ascii4(bytes, position + 4);
    let header = 8;
    if (size === 1) {
      size = be32(bytes, position + 8) * 4294967296 + be32(bytes, position + 12);
      header = 16;
    } else if (size === 0) {
      size = end - position;
    }
    if (size < header || position + size > end) break;
    if (visit(type, position + header, position + size) === true) return;
    position += size;
  }
}

function findBox(bytes, start, end, wanted) {
  let found = null;
  walkBoxes(bytes, start, end, (type, s, e) => {
    if (type === wanted) {
      found = [s, e];
      return true;
    }
    return false;
  });
  return found;
}

async function readMp4(file) {
  let position = 0;
  let moov = null;
  while (position + 8 <= file.size) {
    const head = await readBytes(file, position, position + 16);
    let size = be32(head, 0);
    const type = ascii4(head, 4);
    let header = 8;
    if (size === 1) {
      size = be32(head, 8) * 4294967296 + be32(head, 12);
      header = 16;
    } else if (size === 0) {
      size = file.size - position;
    }
    if (size < header) break;
    if (type === "moov") {
      if (size - header > MAX_TAG_BYTES) break;
      moov = await readBytes(file, position + header, position + size);
      break;
    }
    position += size;
  }
  if (!moov) return null;
  const udta = findBox(moov, 0, moov.length, "udta");
  if (!udta) return null;
  const meta = findBox(moov, udta[0], udta[1], "meta");
  if (!meta) return null;
  const ilst = findBox(moov, meta[0] + 4, meta[1], "ilst");
  if (!ilst) return null;
  const out = { title: "", artist: "", album: "", cover: null };
  walkBoxes(moov, ilst[0], ilst[1], (key, start, end) => {
    const data = findBox(moov, start, end, "data");
    if (!data) return false;
    const payload = moov.subarray(data[0] + 8, data[1]);
    if (key === "\u00a9nam") out.title = decodeText(payload, "utf-8").trim();
    else if (key === "\u00a9ART") out.artist = decodeText(payload, "utf-8").trim();
    else if (key === "\u00a9alb") out.album = decodeText(payload, "utf-8").trim();
    else if (key === "covr") out.cover = makeCover(payload, moov[data[0] + 3] === 14 ? "image/png" : "image/jpeg");
    return false;
  });
  return out;
}

function parsePicture(bytes) {
  if (bytes.length < 32) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mimeLength = view.getUint32(4);
  const mime = latin1(bytes.subarray(8, 8 + mimeLength));
  let position = 8 + mimeLength;
  const descLength = view.getUint32(position);
  position += 4 + descLength + 16;
  const dataLength = view.getUint32(position);
  position += 4;
  return makeCover(bytes.subarray(position, position + dataLength), mime);
}

function base64ToBytes(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

function parseVorbisComment(bytes, start) {
  const out = { title: "", artist: "", album: "", cover: null };
  if (start + 4 > bytes.length) return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = start;
  position += 4 + view.getUint32(position, true);
  if (position + 4 > bytes.length) return out;
  const count = view.getUint32(position, true);
  position += 4;
  for (let i = 0; i < count; i++) {
    if (position + 4 > bytes.length) break;
    const length = view.getUint32(position, true);
    position += 4;
    if (position + length > bytes.length) break;
    const entry = decodeText(bytes.subarray(position, position + length), "utf-8");
    position += length;
    const split = entry.indexOf("=");
    if (split < 1) continue;
    const key = entry.slice(0, split).toUpperCase();
    const value = entry.slice(split + 1).trim();
    if (key === "TITLE" && !out.title) out.title = value;
    else if (key === "ARTIST" && !out.artist) out.artist = value;
    else if (key === "ALBUM" && !out.album) out.album = value;
    else if (key === "METADATA_BLOCK_PICTURE" && !out.cover) out.cover = parsePicture(base64ToBytes(value));
  }
  return out;
}

async function readFlac(file) {
  const out = { title: "", artist: "", album: "", cover: null };
  let position = 4;
  while (position + 4 <= file.size) {
    const head = await readBytes(file, position, position + 4);
    const last = head[0] & 0x80;
    const type = head[0] & 0x7f;
    const length = (head[1] << 16) | (head[2] << 8) | head[3];
    if (length <= MAX_TAG_BYTES) {
      if (type === 4) {
        const block = await readBytes(file, position + 4, position + 4 + length);
        const comments = parseVorbisComment(block, 0);
        out.title = out.title || comments.title;
        out.artist = out.artist || comments.artist;
        out.album = out.album || comments.album;
      } else if (type === 6 && !out.cover) {
        out.cover = parsePicture(await readBytes(file, position + 4, position + 4 + length));
      }
    }
    position += 4 + length;
    if (last) break;
  }
  return out;
}

async function readOgg(file) {
  const buffer = await readBytes(file, 0, 3 * 1024 * 1024);
  const parts = [];
  let total = 0;
  let position = 0;
  while (position + 27 <= buffer.length && ascii4(buffer, position) === "OggS") {
    const segments = buffer[position + 26];
    let length = 0;
    for (let i = 0; i < segments; i++) length += buffer[position + 27 + i];
    const start = position + 27 + segments;
    parts.push(buffer.subarray(start, start + length));
    total += length;
    position = start + length;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const probe = latin1(joined.subarray(0, Math.min(joined.length, 65536)));
  const vorbis = probe.indexOf("\u0003vorbis");
  if (vorbis >= 0) return parseVorbisComment(joined, vorbis + 7);
  const opus = probe.indexOf("OpusTags");
  if (opus >= 0) return parseVorbisComment(joined, opus + 8);
  return null;
}

function fillTags(target, source) {
  if (!source) return;
  if (!target.title && source.title) target.title = source.title;
  if (!target.artist && source.artist) target.artist = source.artist;
  if (!target.album && source.album) target.album = source.album;
  if (!target.cover && source.cover) target.cover = source.cover;
}

async function readMetadata(file) {
  const result = { title: "", artist: "", album: "", cover: null };
  try {
    const head = await readBytes(file, 0, 12);
    const signature = latin1(head.subarray(0, 4));
    if (signature === "fLaC") fillTags(result, await readFlac(file));
    else if (signature === "OggS") fillTags(result, await readOgg(file));
    else if (latin1(head.subarray(4, 8)) === "ftyp") fillTags(result, await readMp4(file));
    else {
      fillTags(result, await readId3v2(file));
      fillTags(result, await readId3v1(file));
    }
  } catch {
    return result;
  }
  return result;
}

function titleFromName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim() || name;
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Timed out reading file")), 12000);
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) finish(null, probe.duration);
      else finish(null, 0);
    };
    probe.onerror = () => finish(new Error("Unsupported audio format"));
    probe.src = url;
  });
}

function isAudioFile(file) {
  return file.type.startsWith("audio/") || file.type === "video/mp4" || AUDIO_EXT.test(file.name);
}

function findTrack(id) {
  return state.tracks.find((track) => track.id === id) || null;
}

function setImporting(active, done = 0, total = 0) {
  state.importing = active;
  els.addBtn.classList.toggle("busy", active);
  els.addLabel.textContent = active ? `Importing ${done}/${total}` : "Add Music";
}

async function importFiles(fileList) {
  if (state.importing) {
    toast("An import is already running", "info");
    return;
  }
  const all = Array.from(fileList);
  const files = all.filter(isAudioFile);
  if (!files.length) {
    if (all.length) toast("No supported audio files in that selection", "error");
    return;
  }
  const skippedType = all.length - files.length;
  const existing = new Set(state.tracks.map((track) => track.key));
  const failed = [];
  let duplicates = 0;
  let added = 0;
  let firstAdded = null;
  const base = Date.now();
  setImporting(true, 0, files.length);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setImporting(true, i + 1, files.length);
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (existing.has(key)) {
      duplicates++;
      continue;
    }
    try {
      const [meta, duration] = await Promise.all([readMetadata(file), probeDuration(file)]);
      const track = {
        id: makeId(),
        key,
        name: file.name,
        size: file.size,
        type: file.type,
        file,
        title: meta.title || titleFromName(file.name),
        artist: meta.artist || "",
        album: meta.album || "",
        duration,
        cover: meta.cover ? new Blob([meta.cover.data], { type: meta.cover.mime }) : null,
        addedAt: base + i,
        lastPlayed: 0,
      };
      if (state.dbReady) {
        try {
          await dbPut(track);
        } catch (error) {
          const quota = error && error.name === "QuotaExceededError";
          failed.push(quota ? `${file.name} (not enough storage)` : file.name);
          continue;
        }
      }
      track.coverUrl = track.cover ? URL.createObjectURL(track.cover) : null;
      state.tracks.push(track);
      existing.add(key);
      state.fresh.add(track.id);
      if (!firstAdded) firstAdded = track;
      added++;
      renderList();
    } catch (error) {
      failed.push(file.name);
    }
  }

  setImporting(false);
  state.tracks.sort((a, b) => a.addedAt - b.addedAt);
  renderList();

  if (added && !state.currentId && firstAdded) {
    state.queue = state.tracks.map((track) => track.id);
    playTrack(firstAdded.id, { autoplay: false });
  } else if (added) {
    syncQueue();
  }

  if (added) {
    toast(`Added ${added} ${added === 1 ? "song" : "songs"} to your library`, "success");
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  if (duplicates) toast(`${duplicates} already in your library, skipped`, "info");
  if (failed.length) toast(`Could not import ${failed.length === 1 ? failed[0] : `${failed.length} files`}`, "error", 6000);
  if (skippedType && !added && !failed.length && !duplicates) toast("No supported audio files were found", "error");
  setTimeout(() => state.fresh.clear(), 800);
}

function syncQueue() {
  const known = new Set(state.tracks.map((track) => track.id));
  state.queue = state.queue.filter((id) => known.has(id));
  if (!state.queue.length) state.queue = state.tracks.map((track) => track.id);
}

function visibleTracks() {
  let list = state.tracks.slice();
  if (state.view === "recent") {
    list = list.filter((track) => track.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, RECENT_LIMIT);
  }
  const query = state.query.trim().toLowerCase();
  if (query) {
    list = list.filter((track) => `${track.title} ${track.artist} ${track.album} ${track.name}`.toLowerCase().includes(query));
  }
  return list;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(track, index) {
  const row = element("div", "track");
  row.setAttribute("role", "listitem");
  row.tabIndex = 0;
  row.dataset.id = track.id;
  if (track.id === state.currentId) row.classList.add("current");
  if (state.fresh.has(track.id)) row.classList.add("enter");

  const lead = element("div", "lead");
  lead.appendChild(element("span", "num", String(index + 1)));
  lead.insertAdjacentHTML("beforeend", ICONS.rowPlay);
  const eq = element("div", "eq");
  for (let i = 0; i < 4; i++) eq.appendChild(document.createElement("span"));
  lead.appendChild(eq);

  const thumb = element("div", "thumb");
  if (track.coverUrl) {
    const img = document.createElement("img");
    img.src = track.coverUrl;
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    thumb.insertAdjacentHTML("beforeend", ICONS.note);
  }

  const info = element("div", "info");
  info.appendChild(element("div", "t", track.title));
  const sub = [track.artist || "Unknown artist", track.album].filter(Boolean).join(" \u00b7 ");
  info.appendChild(element("div", "s", sub));

  const duration = element("div", "dur", track.duration ? formatTime(track.duration) : "");

  const remove = element("button", "icon-btn remove");
  remove.type = "button";
  remove.title = "Remove from library";
  remove.setAttribute("aria-label", `Remove ${track.title}`);
  remove.insertAdjacentHTML("beforeend", ICONS.remove);

  row.append(lead, thumb, info, duration, remove);
  return row;
}

function renderList() {
  const total = state.tracks.length;
  const recentCount = state.tracks.filter((track) => track.lastPlayed > 0).length;
  const list = visibleTracks();

  els.countAll.textContent = String(total);
  els.countRecent.textContent = String(Math.min(recentCount, RECENT_LIMIT));
  els.clearBtn.disabled = total === 0 || state.importing;

  if (!state.loaded) {
    els.stats.textContent = "Loading";
  } else if (total === 0) {
    els.stats.textContent = "No songs yet";
  } else {
    const seconds = state.tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
    const bytes = state.tracks.reduce((sum, track) => sum + track.size, 0);
    els.stats.textContent = `${total} ${total === 1 ? "song" : "songs"} \u00b7 ${formatTotal(seconds)} \u00b7 ${formatSize(bytes)} stored locally`;
  }

  if (!state.loaded) return;

  els.list.replaceChildren(...list.map(buildRow));
  els.list.classList.toggle("playing", state.playing);

  const noLibrary = total === 0;
  els.emptyLibrary.hidden = !noLibrary;
  els.list.hidden = noLibrary;

  const noResults = !noLibrary && list.length === 0;
  els.emptyResults.hidden = !noResults;
  if (noResults) {
    if (state.query.trim()) {
      els.emptyResultsTitle.textContent = "No matches";
      els.emptyResultsText.textContent = `Nothing in your library matches "${state.query.trim()}".`;
    } else {
      els.emptyResultsTitle.textContent = "Nothing played yet";
      els.emptyResultsText.textContent = "Songs you play will show up here.";
    }
  }
  els.list.hidden = noLibrary || noResults;
  updateTransportState();
}

function markCurrent() {
  els.list.querySelectorAll(".track").forEach((row) => {
    row.classList.toggle("current", row.dataset.id === state.currentId);
  });
}

function updateTransportState() {
  const empty = state.tracks.length === 0;
  els.prevBtn.disabled = empty;
  els.nextBtn.disabled = empty;
  els.shuffleBtn.disabled = empty;
  els.repeatBtn.disabled = empty;
  els.seek.disabled = !state.currentId;
}

function updateNowPlaying(track) {
  if (!track) {
    els.title.textContent = "Nothing playing";
    els.artist.textContent = state.tracks.length ? "Choose a song from your library" : "Add a song to get started";
    els.album.textContent = "";
    els.artImg.hidden = true;
    els.artImg.removeAttribute("src");
    els.artFallback.hidden = false;
    document.title = "OnlineAudio";
    setAccentTarget(null);
    updateProgress(true);
    return;
  }
  els.title.textContent = track.title;
  els.title.title = track.title;
  els.artist.textContent = track.artist || "Unknown artist";
  els.album.textContent = track.album;
  if (track.coverUrl) {
    els.artImg.hidden = false;
    els.artImg.src = track.coverUrl;
    els.artFallback.hidden = true;
  } else {
    els.artImg.hidden = true;
    els.artImg.removeAttribute("src");
    els.artFallback.hidden = false;
  }
  document.title = `${track.title} | OnlineAudio`;
  setAccentTarget(track);
  updateMediaSession(track);
  updateTransportState();
  updateProgress(true);
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: "512x512", type: track.cover ? track.cover.type : "image/jpeg" }] : [],
    });
  } catch {
    return;
  }
}

function setAccentTarget(track) {
  if (!track || !track.coverUrl) {
    state.accentTarget = DEFAULT_ACCENT.slice();
    state.accentKey = "";
    return;
  }
  const key = track.id;
  state.accentKey = key;
  const image = new Image();
  image.onload = () => {
    if (state.accentKey !== key) return;
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    try {
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        const w = (max - min) / 255 + 0.05;
        r += pixels[i] * w;
        g += pixels[i + 1] * w;
        b += pixels[i + 2] * w;
        weight += w;
      }
      r /= weight;
      g /= weight;
      b /= weight;
      const peak = Math.max(r, g, b, 1);
      const scale = 235 / peak;
      let color = [r * scale, g * scale, b * scale];
      const saturation = (Math.max(...color) - Math.min(...color)) / 235;
      if (saturation < 0.22) {
        const mix = 0.65;
        color = color.map((value, index) => value * (1 - mix) + DEFAULT_ACCENT[index] * mix);
      }
      state.accentTarget = color.map((value) => Math.round(Math.min(255, Math.max(40, value))));
    } catch {
      state.accentTarget = DEFAULT_ACCENT.slice();
    }
  };
  image.onerror = () => {
    state.accentTarget = DEFAULT_ACCENT.slice();
  };
  image.src = track.coverUrl;
}

function updateProgress(force = false) {
  const track = findTrack(state.currentId);
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track ? track.duration : 0;
  const current = track ? audio.currentTime : 0;
  const second = Math.floor(current);
  if (!force && second === state.lastSecond && !state.playing) return;
  state.lastSecond = second;
  const ratio = duration ? Math.min(1, current / duration) : 0;
  if (!state.seeking) {
    els.seek.value = String(Math.round(ratio * 1000));
    els.seek.style.setProperty("--fill", `${ratio * 100}%`);
    els.curTime.textContent = formatTime(current);
  }
  els.durTime.textContent = formatTime(duration);
}

function ensureGraph() {
  if (state.ctx) {
    if (state.ctx.state === "suspended") state.ctx.resume().catch(() => {});
    return;
  }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    const ctx = new Context();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    state.ctx = ctx;
    state.analyser = analyser;
    state.freq = new Uint8Array(analyser.frequencyBinCount);
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    state.analyser = null;
  }
}

async function playTrack(id, options = {}) {
  const track = findTrack(id);
  if (!track) return;
  const { autoplay = true, back = false } = options;

  if (state.currentId && state.currentId !== id && !back) {
    state.history.push(state.currentId);
    if (state.history.length > 200) state.history.shift();
  }
  state.currentId = id;
  state.played.add(id);

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(track.file);
  audio.src = state.objectUrl;
  audio.loop = state.repeat === "one";

  updateNowPlaying(track);
  markCurrent();
  saveSettings();

  if (!autoplay) return;

  ensureGraph();
  track.lastPlayed = Date.now();
  dbPut(track).catch(() => {});
  if (state.view === "recent") renderList();
  else {
    els.countRecent.textContent = String(Math.min(state.tracks.filter((item) => item.lastPlayed > 0).length, RECENT_LIMIT));
  }

  try {
    await audio.play();
  } catch (error) {
    if (error && error.name === "NotAllowedError") toast("Press play to start the music", "info");
    else if (error && error.name !== "AbortError") toast(`Could not play "${track.title}"`, "error");
  }
}

function randomFrom(ids) {
  return ids[Math.floor(Math.random() * ids.length)];
}

function pickNext(auto, fromId = state.currentId) {
  syncQueue();
  const queue = state.queue;
  if (!queue.length) return null;
  const index = queue.indexOf(fromId);

  if (state.shuffle) {
    if (queue.length === 1) return auto && state.repeat !== "all" ? null : queue[0];
    let pool = queue.filter((id) => !state.played.has(id) && id !== fromId);
    if (!pool.length) {
      if (auto && state.repeat !== "all") return null;
      state.played = new Set(fromId ? [fromId] : []);
      pool = queue.filter((id) => id !== fromId);
    }
    return randomFrom(pool);
  }

  const nextIndex = index + 1;
  if (nextIndex >= queue.length) {
    if (auto && state.repeat !== "all") return null;
    return queue[0];
  }
  return queue[nextIndex];
}

function nextTrack(auto = false) {
  if (!state.tracks.length) return;
  const id = pickNext(auto);
  if (!id) {
    audio.pause();
    audio.currentTime = 0;
    updateProgress(true);
    return;
  }
  playTrack(id);
}

function previousTrack() {
  if (!state.tracks.length) return;
  if (state.currentId && audio.currentTime > 3) {
    audio.currentTime = 0;
    updateProgress(true);
    return;
  }
  while (state.history.length) {
    const id = state.history.pop();
    if (findTrack(id) && id !== state.currentId) {
      playTrack(id, { back: true });
      return;
    }
  }
  syncQueue();
  const index = state.queue.indexOf(state.currentId);
  if (state.shuffle || index === -1) {
    if (state.currentId) {
      audio.currentTime = 0;
      updateProgress(true);
    } else {
      playTrack(state.queue[0]);
    }
    return;
  }
  const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
  playTrack(previous, { back: true });
}

function togglePlay() {
  if (!state.tracks.length) {
    els.fileInput.click();
    return;
  }
  if (!state.currentId) {
    state.queue = visibleTracks().map((track) => track.id);
    if (!state.queue.length) state.queue = state.tracks.map((track) => track.id);
    state.played.clear();
    playTrack(state.shuffle ? randomFrom(state.queue) : state.queue[0]);
    return;
  }
  if (audio.paused) {
    ensureGraph();
    audio.play().catch((error) => {
      if (error && error.name !== "AbortError") toast("Could not play this file", "error");
    });
  } else {
    audio.pause();
  }
}

function updatePlayState() {
  state.playing = !audio.paused && !audio.ended;
  document.body.classList.toggle("is-playing", state.playing);
  els.list.classList.toggle("playing", state.playing);
  els.playIcon.innerHTML = state.playing ? ICONS.pause : ICONS.play;
  const label = state.playing ? "Pause" : "Play";
  els.playBtn.title = label;
  els.playBtn.setAttribute("aria-label", label);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
}

function setShuffle(value) {
  state.shuffle = value;
  state.played = new Set(state.currentId ? [state.currentId] : []);
  els.shuffleBtn.classList.toggle("on", value);
  els.shuffleBtn.setAttribute("aria-pressed", String(value));
  els.shuffleBtn.title = value ? "Shuffle: on" : "Shuffle: off";
  saveSettings();
}

function setRepeat(mode) {
  state.repeat = mode;
  audio.loop = mode === "one";
  els.repeatBtn.classList.toggle("on", mode !== "off");
  els.repeatBtn.classList.toggle("one", mode === "one");
  const labels = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" };
  els.repeatBtn.title = labels[mode];
  els.repeatBtn.setAttribute("aria-label", labels[mode]);
  saveSettings();
}

function updateVolumeUI() {
  const level = audio.muted ? 0 : audio.volume;
  els.volume.value = String(Math.round(level * 100));
  els.volume.style.setProperty("--fill", `${level * 100}%`);
  els.volLabel.textContent = String(Math.round(level * 100));
  els.volIcon.innerHTML = level === 0 ? ICONS.volMute : level < 0.5 ? ICONS.volLow : ICONS.volHigh;
  els.muteBtn.title = audio.muted || level === 0 ? "Unmute" : "Mute";
  els.muteBtn.setAttribute("aria-label", els.muteBtn.title);
}

function setVolume(value) {
  audio.volume = Math.min(1, Math.max(0, value));
  if (audio.volume > 0 && audio.muted) audio.muted = false;
  updateVolumeUI();
  saveSettings();
}

function toggleMute() {
  if (audio.volume === 0) {
    audio.volume = 0.6;
    audio.muted = false;
  } else {
    audio.muted = !audio.muted;
  }
  updateVolumeUI();
  saveSettings();
}

function resetPlayer() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.currentId = null;
  updateNowPlaying(null);
  updatePlayState();
  updateTransportState();
  saveSettings();
}

async function removeTrack(id, row) {
  const track = findTrack(id);
  if (!track) return;
  const wasCurrent = id === state.currentId;
  const wasPlaying = state.playing;
  let nextId = null;
  if (wasCurrent) {
    nextId = pickNext(false, id);
    if (nextId === id) nextId = null;
  }

  try {
    if (state.dbReady) await dbDelete(id);
  } catch {
    toast("Could not remove that song", "error");
    return;
  }

  if (row) {
    row.classList.add("removing");
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
  state.tracks = state.tracks.filter((item) => item.id !== id);
  state.queue = state.queue.filter((item) => item !== id);
  state.history = state.history.filter((item) => item !== id);
  state.played.delete(id);

  if (wasCurrent) {
    state.currentId = null;
    if (nextId && findTrack(nextId)) playTrack(nextId, { autoplay: wasPlaying });
    else resetPlayer();
  }
  renderList();
  toast(`Removed "${track.title}"`, "info", 2600);
}

async function clearLibrary() {
  try {
    if (state.dbReady) await dbClear();
  } catch {
    toast("Could not clear the library", "error");
    return;
  }
  state.tracks.forEach((track) => {
    if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
  });
  state.tracks = [];
  state.queue = [];
  state.history = [];
  state.played.clear();
  resetPlayer();
  renderList();
  toast("Library cleared", "info", 2600);
}

function setView(view) {
  state.view = view;
  els.tabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderList();
}

function onRowActivate(event) {
  const removeButton = event.target.closest(".remove");
  const row = event.target.closest(".track");
  if (!row) return;
  const id = row.dataset.id;
  if (removeButton) {
    event.stopPropagation();
    removeTrack(id, row);
    return;
  }
  if (id === state.currentId) {
    togglePlay();
    return;
  }
  state.queue = visibleTracks().map((track) => track.id);
  state.played = new Set();
  playTrack(id);
}

const vizContext = els.viz.getContext("2d");
let vizWidth = 0;
let vizHeight = 0;
let pixelRatio = 1;

function resizeViz() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  vizWidth = els.viz.clientWidth;
  vizHeight = els.viz.clientHeight;
  els.viz.width = Math.max(1, Math.round(vizWidth * pixelRatio));
  els.viz.height = Math.max(1, Math.round(vizHeight * pixelRatio));
}

function placeLight() {
  const rect = els.player.getBoundingClientRect();
  const root = document.documentElement.style;
  root.setProperty("--lx", `${Math.round(rect.left + rect.width / 2)}px`);
  root.setProperty("--ly", `${Math.round(rect.top + Math.min(rect.height, window.innerHeight) / 2)}px`);
}

function drawViz(live) {
  const width = els.viz.width;
  const height = els.viz.height;
  const ctx = vizContext;
  ctx.clearRect(0, 0, width, height);
  const freq = state.freq;
  const maxBin = freq ? Math.floor(freq.length * 0.72) : 0;
  const gap = 3 * pixelRatio;
  const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  const [r, g, b] = state.accent;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `rgb(${Math.round(r + (255 - r) * 0.35)}, ${Math.round(g + (255 - g) * 0.35)}, ${Math.round(b + (255 - b) * 0.35)})`);
  gradient.addColorStop(0.5, `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
  gradient.addColorStop(1, "rgb(59, 130, 246)");
  ctx.fillStyle = gradient;
  ctx.shadowColor = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.7)`;
  ctx.shadowBlur = 10 * pixelRatio;

  for (let i = 0; i < BAR_COUNT; i++) {
    let value = 0;
    if (live && freq) {
      const lo = Math.floor(Math.pow(i / BAR_COUNT, 1.6) * maxBin);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BAR_COUNT, 1.6) * maxBin));
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += freq[k];
      value = Math.pow(sum / (hi - lo) / 255, 1.25) * (1 + (i / BAR_COUNT) * 0.5);
    }
    const level = Math.max(value, state.levels[i] * 0.86);
    state.levels[i] = level;
    const barHeight = Math.max(3 * pixelRatio, Math.min(1, level) * height * 0.96);
    const x = i * (barWidth + gap);
    const y = (height - barHeight) / 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }
}

function frame() {
  requestAnimationFrame(frame);
  const live = Boolean(state.analyser) && state.playing;
  let bass = 0;
  if (live) {
    state.analyser.getByteFrequencyData(state.freq);
    for (let i = 0; i < 6; i++) bass += state.freq[i];
    bass = Math.min(1, (bass / (6 * 255)) * 1.15);
  } else if (state.playing) {
    bass = 0.25 + Math.abs(Math.sin(performance.now() / 380)) * 0.2;
  }
  const target = state.playing ? 0.42 + bass * 0.58 : state.currentId ? 0.2 : 0.12;
  state.glow += (target - state.glow) * 0.14;
  document.documentElement.style.setProperty("--glow", state.glow.toFixed(3));

  let changed = false;
  for (let i = 0; i < 3; i++) {
    const delta = state.accentTarget[i] - state.accent[i];
    if (Math.abs(delta) > 0.4) {
      state.accent[i] += delta * 0.06;
      changed = true;
    }
  }
  if (changed) {
    document.documentElement.style.setProperty("--accent", state.accent.map((value) => Math.round(value)).join(", "));
  }

  drawViz(live);
  if (state.playing) updateProgress();
}

function bindEvents() {
  els.addBtn.addEventListener("click", () => els.fileInput.click());
  els.emptyAdd.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const files = Array.from(els.fileInput.files || []);
    els.fileInput.value = "";
    importFiles(files);
  });

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", () => nextTrack(false));
  els.prevBtn.addEventListener("click", previousTrack);
  els.shuffleBtn.addEventListener("click", () => setShuffle(!state.shuffle));
  els.repeatBtn.addEventListener("click", () => {
    const order = ["off", "all", "one"];
    setRepeat(order[(order.indexOf(state.repeat) + 1) % order.length]);
  });
  els.muteBtn.addEventListener("click", toggleMute);
  els.volume.addEventListener("input", () => setVolume(Number(els.volume.value) / 100));

  els.seek.addEventListener("input", () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (!duration) return;
    state.seeking = true;
    const ratio = Number(els.seek.value) / 1000;
    els.seek.style.setProperty("--fill", `${ratio * 100}%`);
    els.curTime.textContent = formatTime(ratio * duration);
  });
  els.seek.addEventListener("change", () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration) audio.currentTime = (Number(els.seek.value) / 1000) * duration;
    state.seeking = false;
    updateProgress(true);
  });

  els.list.addEventListener("click", onRowActivate);
  els.list.addEventListener("keydown", (event) => {
    if (event.target.classList.contains("track") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onRowActivate(event);
    } else if (event.target.classList.contains("track") && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const sibling = event.key === "ArrowDown" ? event.target.nextElementSibling : event.target.previousElementSibling;
      if (sibling) sibling.focus();
    } else if (event.target.classList.contains("track") && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      removeTrack(event.target.dataset.id, event.target);
    }
  });

  els.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderList();
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.search.value) {
      els.search.value = "";
      state.query = "";
      renderList();
    }
  });

  els.clearBtn.addEventListener("click", () => {
    if (typeof els.confirmDialog.showModal === "function") els.confirmDialog.showModal();
    else if (window.confirm("Clear your library?")) clearLibrary();
  });
  els.confirmDialog.addEventListener("close", () => {
    if (els.confirmDialog.returnValue === "confirm") clearLibrary();
    els.confirmDialog.returnValue = "";
  });

  audio.addEventListener("play", updatePlayState);
  audio.addEventListener("pause", updatePlayState);
  audio.addEventListener("playing", updatePlayState);
  audio.addEventListener("loadedmetadata", () => updateProgress(true));
  audio.addEventListener("durationchange", () => updateProgress(true));
  audio.addEventListener("seeked", () => updateProgress(true));
  audio.addEventListener("ended", () => {
    updatePlayState();
    nextTrack(true);
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    const track = findTrack(state.currentId);
    toast(`Could not play "${track ? track.title : "this file"}"`, "error");
    updatePlayState();
  });

  let dragDepth = 0;
  const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    els.dropzone.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dropzone.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    els.dropzone.hidden = true;
    importFiles(event.dataTransfer.files);
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (els.confirmDialog.open) return;
    const target = event.target;
    const typing = target && (target.tagName === "INPUT" && target.type !== "range" ? true : target.tagName === "TEXTAREA");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      els.search.focus();
      return;
    }
    if (typing) return;
    const onButton = target && (target.tagName === "BUTTON" || target.classList.contains("track"));
    if (event.code === "Space" && !onButton) {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowRight" && target.type !== "range") {
      event.preventDefault();
      if (event.shiftKey) nextTrack(false);
      else if (state.currentId) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    } else if (event.key === "ArrowLeft" && target.type !== "range") {
      event.preventDefault();
      if (event.shiftKey) previousTrack();
      else if (state.currentId) audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (event.key.toLowerCase() === "m") {
      toggleMute();
    }
  });

  if ("mediaSession" in navigator) {
    const handlers = {
      play: () => togglePlay(),
      pause: () => audio.pause(),
      previoustrack: previousTrack,
      nexttrack: () => nextTrack(false),
      seekto: (details) => {
        if (details && typeof details.seekTime === "number") audio.currentTime = details.seekTime;
      },
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        return;
      }
    });
  }

  window.addEventListener("resize", () => {
    resizeViz();
    placeLight();
  });
  window.addEventListener("scroll", placeLight, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => {
    resizeViz();
    placeLight();
  }).observe(els.player);
}

async function init() {
  audio.volume = settings.volume;
  audio.muted = settings.muted;
  updateVolumeUI();
  updatePlayState();
  setShuffle(settings.shuffle);
  setRepeat(settings.repeat);
  bindEvents();
  resizeViz();
  placeLight();
  requestAnimationFrame(frame);

  let records = [];
  try {
    records = await dbGetAll();
    state.dbReady = true;
  } catch {
    state.dbReady = false;
    toast("Local storage is unavailable. Songs will not survive a refresh.", "error", 7000);
  }

  state.tracks = records
    .filter((record) => record && record.file)
    .map((record) => ({ ...record, coverUrl: record.cover ? URL.createObjectURL(record.cover) : null }))
    .sort((a, b) => a.addedAt - b.addedAt);
  state.loaded = true;
  state.queue = state.tracks.map((track) => track.id);
  renderList();

  const last = settings.last && findTrack(settings.last);
  if (last) playTrack(last.id, { autoplay: false });
  else updateNowPlaying(null);
}

init();
