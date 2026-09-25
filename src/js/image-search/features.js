// 画像 → 字形の特徴。scripts/build_image_index.py と同じ前処理にすること。
//   1) 背景色を見て「墨」の濃さに直す（白地に黒字／黒地に白字のどちらでも可）
//   2) 墨のある範囲を切り出し、縦横比を保って BOX×BOX の中央に収める
//   3) 段1 用の 8x8 濃淡（内積で比較）と、段2 用の 16x16 白黒（ハミング距離で比較）を作る

export const BOX = 64;
export const GRAY_MESH = 8;
export const BIN_MESH = 16;
export const BIN_THRESHOLD = 0.22;
const BLUR_RADIUS = 2; // ずれに強くするためのぼかし（build_image_index.py と同じ）
const BLUR_PASSES = 2;
const INK_THRESHOLD = 32; // 0-255。これを超えた画素を「墨」とみなす

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA
 * @returns {Float32Array | null} BOX*BOX の墨の濃さ（0-1）。墨が無ければ null
 */
export function normalizeImage(image) {
  const ink = toInk(image);
  const bounds = inkBounds(ink, image.width, image.height);
  if (!bounds) return null;
  return fitToBox(ink, image.width, bounds);
}

/** 背景（周囲の明るさの中央値）との差を墨の濃さにする */
function toInk(image) {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const alpha = data[p + 3] / 255;
    // 透明な部分は白（背景）とみなす
    gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * alpha + 255 * (1 - alpha);
  }
  const border = [];
  for (let x = 0; x < width; x++) border.push(gray[x], gray[(height - 1) * width + x]);
  for (let y = 0; y < height; y++) border.push(gray[y * width], gray[y * width + width - 1]);
  border.sort((a, b) => a - b);
  const background = border[border.length >> 1];

  const ink = new Float32Array(gray.length);
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = background >= 128 ? background - gray[i] : gray[i] - background; // 白地なら暗いほど墨
    ink[i] = v > 0 ? v : 0;
    if (ink[i] > max) max = ink[i];
  }
  if (max > 0) for (let i = 0; i < ink.length; i++) ink[i] = (ink[i] / max) * 255;
  return ink;
}

function inkBounds(ink, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x] > INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** 切り出した範囲を BOX×BOX の中央へ（面積平均で縮小するので、細い線も残る） */
function fitToBox(ink, width, { minX, minY, maxX, maxY }) {
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const scale = (BOX - 4) / Math.max(cropWidth, cropHeight);
  const outWidth = Math.max(1, Math.round(cropWidth * scale));
  const outHeight = Math.max(1, Math.round(cropHeight * scale));
  const offsetX = (BOX - outWidth) >> 1;
  const offsetY = (BOX - outHeight) >> 1;

  const out = new Float32Array(BOX * BOX);
  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = minY + (oy * cropHeight) / outHeight;
    const y1 = minY + ((oy + 1) * cropHeight) / outHeight;
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = minX + (ox * cropWidth) / outWidth;
      const x1 = minX + ((ox + 1) * cropWidth) / outWidth;
      let sum = 0;
      let count = 0;
      for (let y = Math.floor(y0); y < Math.max(Math.ceil(y1), Math.floor(y0) + 1); y++) {
        for (let x = Math.floor(x0); x < Math.max(Math.ceil(x1), Math.floor(x0) + 1); x++) {
          sum += ink[y * width + x];
          count++;
        }
      }
      out[(oy + offsetY) * BOX + ox + offsetX] = count ? sum / count / 255 : 0;
    }
  }
  return out;
}

/** 箱ぼかし（線が細い字形でも、半マスのずれで別物にならないようにする） */
export function blur(norm, radius = BLUR_RADIUS, passes = BLUR_PASSES) {
  const width = radius * 2 + 1;
  let src = norm;
  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(BOX * BOX);
    for (let y = 0; y < BOX; y++) {
      for (let x = 0; x < BOX; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < BOX) sum += src[y * BOX + xx];
        }
        horizontal[y * BOX + x] = sum / width;
      }
    }
    const out = new Float32Array(BOX * BOX);
    for (let y = 0; y < BOX; y++) {
      for (let x = 0; x < BOX; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < BOX) sum += horizontal[yy * BOX + x];
        }
        out[y * BOX + x] = sum / width;
      }
    }
    src = out;
  }
  return src;
}

/** BOX×BOX → size×size の平均 */
export function mesh(norm, size) {
  const step = BOX / size;
  const out = new Float32Array(size * size);
  for (let y = 0; y < BOX; y++) {
    for (let x = 0; x < BOX; x++) {
      out[((y / step) | 0) * size + ((x / step) | 0)] += norm[y * BOX + x];
    }
  }
  const per = step * step;
  for (let i = 0; i < out.length; i++) out[i] /= per;
  return out;
}

/** 段1 の特徴（長さ 1 にそろえた 8x8 濃淡） */
export function grayFeature(norm) {
  const cells = mesh(blur(norm), GRAY_MESH);
  let sum = 0;
  for (const v of cells) sum += v * v;
  const length = Math.sqrt(sum) || 1;
  for (let i = 0; i < cells.length; i++) cells[i] /= length;
  return cells;
}

/** 段2 の特徴（16x16 白黒。1 ビット 1 マス、上位ビットから） */
export function binaryFeature(norm) {
  const cells = mesh(blur(norm), BIN_MESH);
  const bytes = new Uint8Array(cells.length / 8);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] > BIN_THRESHOLD) bytes[i >> 3] |= 0x80 >> (i & 7);
  }
  return bytes;
}
