/**
 * 从设备截图中解码二维码，验证“屏幕上真正显示出来的码”能被内置解码库识别。
 *
 * 用途：`node scripts/decode-shot.js <截图.png> [x,y,w,h]`
 *
 * 之所以不引入依赖：PNG 是 zlib 压缩的扫描线数据，Node 自带 zlib，
 * 这里手写一个只支持 8 位真彩/灰度、无交错的解码器即可满足截图验证。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** 解码 PNG → { width, height, data: Uint8ClampedArray(RGBA) } */
function decodePng(buffer) {
    if (buffer.readUInt32BE(0) !== 0x89504e47) {
        throw new Error('不是 PNG 文件');
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat = [];
    let palette = null;
    let transparency = null;

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            bitDepth = body[8];
            colorType = body[9];
            if (body[12] !== 0) {
                throw new Error('暂不支持交错的 PNG');
            }
        } else if (type === 'PLTE') {
            palette = Buffer.from(body);
        } else if (type === 'tRNS') {
            transparency = Buffer.from(body);
        } else if (type === 'IDAT') {
            idat.push(Buffer.from(body));
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }
    if (bitDepth !== 8) {
        throw new Error(`暂不支持 ${bitDepth} 位深的 PNG`);
    }

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) {
        throw new Error(`暂不支持的颜色类型 ${colorType}`);
    }
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);

    // 逐行反过滤：filter 类型见 PNG 规范 Table 9。
    let position = 0;
    for (let y = 0; y < height; y += 1) {
        const filter = raw[position];
        position += 1;
        const line = raw.subarray(position, position + stride);
        position += stride;
        const out = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x += 1) {
            const left = x >= channels ? out[x - channels] : 0;
            const up = prior ? prior[x] : 0;
            const upLeft = prior && x >= channels ? prior[x - channels] : 0;
            let value = line[x];
            if (filter === 1) {
                value += left;
            } else if (filter === 2) {
                value += up;
            } else if (filter === 3) {
                value += (left + up) >> 1;
            } else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
            }
            out[x] = value & 0xff;
        }
    }

    // 统一转成 RGBA，jsQR 只接受这个格式。
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        let r;
        let g;
        let b;
        let a = 255;
        if (colorType === 3) {
            const index = pixels[i];
            r = palette[index * 3];
            g = palette[index * 3 + 1];
            b = palette[index * 3 + 2];
            if (transparency && index < transparency.length) {
                a = transparency[index];
            }
        } else if (colorType === 0 || colorType === 4) {
            r = pixels[i * channels];
            g = r;
            b = r;
            if (colorType === 4) {
                a = pixels[i * channels + 1];
            }
        } else {
            r = pixels[i * channels];
            g = pixels[i * channels + 1];
            b = pixels[i * channels + 2];
            if (colorType === 6) {
                a = pixels[i * channels + 3];
            }
        }
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = a;
    }
    return { width, height, data };
}

/** 裁剪一块区域，返回新的 RGBA 图。 */
function crop(image, x, y, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row += 1) {
        const from = (((y + row) * image.width) + x) * 4;
        data.set(image.data.subarray(from, from + (w * 4)), row * w * 4);
    }
    return { width: w, height: h, data };
}

/**
 * 在整张截图里滑动窗口搜索二维码。
 * 窗口按 1/2 边长步进，覆盖到码即可，避免精确裁剪带来的手工坐标误差。
 */
function search(image, jsQR, minSide = 240) {
    const sizes = [minSide, Math.round(minSide * 1.5), minSide * 2];
    for (const side of sizes) {
        const step = Math.max(40, Math.round(side / 3));
        for (let y = 0; y + side <= image.height; y += step) {
            for (let x = 0; x + side <= image.width; x += step) {
                const found = jsQR(crop(image, x, y, side, side).data, side, side, {
                    inversionAttempts: 'attemptBoth',
                });
                if (found?.data) {
                    return { text: found.data, region: { x, y, side } };
                }
            }
        }
    }
    return null;
}

function main() {
    const [file, box] = process.argv.slice(2);
    if (!file) {
        console.error('用法：node scripts/decode-shot.js <截图.png> [x,y,w,h]');
        process.exitCode = 2;
        return;
    }
    const require_ = require('node:module').createRequire(__filename);
    const jsQR = require_(path.resolve(__dirname, '..',
        'web/public/vendor/jsQR.js'));

    const image = decodePng(fs.readFileSync(file));
    console.log(`截图尺寸：${image.width}×${image.height}`);

    let found = null;
    if (box) {
        const [x, y, w, h] = box.split(',').map(Number);
        const region = crop(image, x, y, w, h);
        const hit = jsQR(region.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (hit?.data) {
            found = { text: hit.data, region: { x, y, side: w } };
        }
    } else {
        found = search(image, jsQR);
    }

    if (!found) {
        console.error('FAIL 没有在截图里识别到二维码');
        process.exitCode = 1;
        return;
    }
    console.log(`PASS 识别到二维码：${found.text}`);
    console.log(`     位置：x=${found.region.x} y=${found.region.y} 边长=${found.region.side}`);
}

if (require.main === module) {
    main();
}

module.exports = { decodePng, crop, search };
