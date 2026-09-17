import { t } from '../core/strings.js';
/**
 * 展商 · 核销报名码
 *
 * 展会在「编辑展会」里开启“是否启用报名二维码”后，报名审核通过的用户会在报名详情
 * 看到报名码。展商在本页用摄像头取景，由内置的 jsQR 在画面里实时识别二维码，
 * 识别成功后调用 `checkin.scan` 把报名状态改为“已参加”。
 *
 * 摄像头不可用（未授权、设备没有摄像头、浏览器不支持 getUserMedia）时，
 * 页面保留“手动输入报名码”的入口，核销链路仍然可用。
 */

import { call } from '../core/bridge.js';
import { checkIn } from '../core/api.js';
import { scaffold, onPageStop } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, toast, openSheet } from '../ui/components.js';
import { el, replace } from '../core/dom.js';
import { REGISTRATION_STATUS } from '../core/status.js';
import { loadQrDecoder } from '../core/vendor.js';

/** 报名码前缀，与原生 WebAppActions.REGISTRATION_CODE_PREFIX 保持一致。 */
const CODE_PREFIX = 'CALMOBILE-CHECKIN|';
const DECODE_WIDTH = 640;
/** 识别节流：约每 120ms 解一帧，既跟得上手势又不占满 CPU。 */
const DECODE_INTERVAL = 120;

export async function checkinPage(context) {
    const video = el('video', {
        class: 'scan-video',
        autoplay: true,
        muted: true,
        playsinline: true,
    });
    const canvas = el('canvas', { class: 'scan-canvas', 'aria-hidden': 'true' });
    const stage = el('div', { class: 'scan-stage' }, [
        video,
        el('div', { class: 'scan-frame', 'aria-hidden': 'true' }),
    ]);
    const stageHost = el('div', { class: 'scan-wrap' });
    const statusHost = el('div', { class: 'stack', 'data-gap': 'sm' });
    const resultHost = el('div', { class: 'stack' });
    const actionHost = el('div', { class: 'stack', 'data-gap': 'sm' });

    let stream = null;
    let frameHandle = 0;
    let scanning = false;
    let lastDecodeAt = 0;
    let submitting = false;
    // 页面被替换后置为 false：异步步骤（权限、getUserMedia）回来时据此放弃取景。
    let alive = true;
    // jsQR 按需加载（约 257KB），进入本页时加载一次，之后缓存在这个引用里。
    let decodeRef = null;
    let decoderFailed = false;

    loadQrDecoder()
        .then((decoder) => {
            decodeRef = decoder;
        })
        .catch((error) => {
            // 摄像头取景仍然可用，但解不了码；页面会提示改用手动输入。
            decoderFailed = true;
            decodeRef = null;
            console.warn(`二维码识别组件加载失败：${error.message}`);
        });

    scaffold({
        title: t('s_zqzoiq'),
        backTo: 'exhibitor',
        bodyProps: { 'data-gap': 'tight' },
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: t('s_oozrzl') }),
                el('span', { class: 'pill', text: REGISTRATION_STATUS.ATTENDED }),
            ]),
            el('p', {
                class: 'row-meta',
                text: t('s_1c3qthv'),
            }),
            stageHost,
            statusHost,
            actionHost,
            resultHost,
        ],
    });

    // 离开本页时一定要关掉摄像头，否则后台会一直占用相机。
    onPageStop(() => {
        alive = false;
        stopScan();
    });

    replace(stageHost, stateBlock({
        iconName: 'image',
        title: t('s_zkl7t2'),
        description: t('s_15lwowq'),
    }));
    renderActions();

    /** 底部动作区：开始扫码 / 手动输入 / 返回展商后台。 */
    function renderActions() {
        replace(actionHost, [
            el('button', {
                class: 'cta',
                type: 'button',
                id: 'scan-start',
                onclick: (event) => startScan(event.currentTarget),
            }, [t('s_wttsdb')]),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => openManualEntry(),
            }, [t('s_11elgkf')]),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate('exhibitor'),
            }, [t('s_dn4ida')]),
        ]);
    }

    // ── 取景与识别 ─────────────────────────────────────────────────

    async function startScan(button) {
        if (scanning) {
            stopScan();
            return;
        }
        if (decoderFailed) {
            replace(statusHost, [
                noticeLine(t('s_dyicmi'), 'error'),
            ]);
            return;
        }
        const supported = typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.getUserMedia === 'function';
        if (!supported) {
            replace(statusHost, [
                noticeLine(t('s_1n1wiu4'), 'error'),
            ]);
            return;
        }
        button.disabled = true;
        button.dataset.loading = 'true';
        try {
            // 先让原生确认摄像头权限，用户同意后 WebView 的 getUserMedia 才会放行。
            const granted = await call('camera.ensurePermission');
            if (granted !== true) {
                replace(statusHost, [
                    noticeLine(t('s_1w8qxkd'), 'error'),
                ]);
                return;
            }
        } catch (error) {
            replace(statusHost, [noticeLine(error.message, 'error')]);
            return;
        } finally {
            button.disabled = false;
            button.dataset.loading = 'false';
        }

        replace(stageHost, stage);
        replace(statusHost, [noticeLine(t('s_i7g6c4'))]);
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
                audio: false,
            });
        } catch (error) {
            replace(stageHost, stateBlock({
                tone: 'error',
                iconName: 'image',
                title: t('s_jkwui8'),
                description: `${error.message || t('s_k3ej4k')}。可以改用“手动输入报名码”。`,
            }));
            replace(statusHost, []);
            return;
        }
        if (!alive) {
            stopStream();
            return;
        }
        video.srcObject = stream;
        try {
            await video.play();
        } catch (ignored) {
            // 部分内核要求用户手势才自动播放，播放失败时下面的循环仍会尝试取帧。
        }
        scanning = true;
        replace(statusHost, [noticeLine(t('s_o51o77'))]);
        scheduleFrame();
    }

    function stopScan() {
        scanning = false;
        if (frameHandle) {
            cancelAnimationFrame(frameHandle);
            frameHandle = 0;
        }
        stopStream();
        replace(stageHost, stateBlock({
            iconName: 'image',
            title: t('s_1nxza37'),
            description: t('s_13eo9zy'),
        }));
        replace(statusHost, []);
    }

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        video.srcObject = null;
    }

    function scheduleFrame() {
        if (!scanning) {
            return;
        }
        frameHandle = requestAnimationFrame((timestamp) => {
            if (!scanning) {
                return;
            }
            if (timestamp - lastDecodeAt >= DECODE_INTERVAL) {
                lastDecodeAt = timestamp;
                decodeFrame();
            }
            scheduleFrame();
        });
    }

    /** 取当前画面中间 4:3 区域解码，兼顾识别率与性能。 */
    function decodeFrame() {
        const decoder = decodeRef;
        if (typeof decoder !== 'function') {
            return;
        }
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
            return;
        }
        const cropWidth = Math.min(width, Math.round(height * 4 / 3));
        const cropHeight = Math.min(height, Math.round(cropWidth * 3 / 4));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            return;
        }
        canvas.width = DECODE_WIDTH;
        canvas.height = Math.round(DECODE_WIDTH * cropHeight / cropWidth);
        context.drawImage(
            video,
            (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight,
            0, 0, canvas.width, canvas.height,
        );
        let imageData;
        try {
            imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (ignored) {
            return;
        }
        const found = decoder(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
        });
        if (found?.data) {
            handleCode(found.data);
        }
    }

    /** 识别到内容后暂停取景，避免同一张码被连续提交。 */
    async function handleCode(raw) {
        if (submitting) {
            return;
        }
        scanning = false;
        if (frameHandle) {
            cancelAnimationFrame(frameHandle);
            frameHandle = 0;
        }
        stopStream();
        replace(stageHost, stateBlock({
            iconName: 'check',
            title: t('s_jimvs7'),
            description: previewOf(raw),
        }));
        await verify(raw);
    }

    function previewOf(raw) {
        const text = String(raw || '');
        if (text.startsWith(CODE_PREFIX)) {
            return t('s_shtqx3');
        }
        return t('s_cq6xrf');
    }

    // ── 核销 ───────────────────────────────────────────────────────

    async function verify(raw) {
        submitting = true;
        replace(statusHost, loadingBlock(1));
        try {
            const result = await checkIn(raw);
            renderResult(result, raw);
        } catch (error) {
            replace(resultHost, []);
            replace(statusHost, stateBlock({
                tone: 'error',
                title: t('s_bctg3f'),
                description: error.message,
                action: { label: t('s_emjfb1'), onClick: () => restart() },
            }));
        } finally {
            submitting = false;
        }
    }

    function renderResult(result, raw) {
        const record = result?.record || {};
        const ok = result?.ok === true;
        replace(statusHost, []);

        const details = el('div', { class: 'card', 'data-tone': 'fill' }, [
            detailRow(t('s_11cd4ta'), record.exhibitionTitle || '—'),
            detailRow(t('s_33njx3'), record.visitorName || '—'),
            detailRow(t('s_17yba4l'), record.registrationTime || '—'),
            detailRow(t('s_vrp4t3'), record.answers || t('s_v8pba2')),
        ]);

        replace(resultHost, el('div', { class: 'stack' }, [
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: ok ? t('s_shfy40') : t('s_1ibqo8o') }),
                    statusTag(ok ? REGISTRATION_STATUS.ATTENDED : (result?.status || t('s_1k1usxy')), ok ? 'ok' : 'danger'),
                ]),
                el('p', { class: 'row-meta', text: result?.message || result?.error || '' }),
                details,
                el('div', { class: 'grid-cols-2' }, [
                    el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => restart(),
                    }, [t('s_emjfb1')]),
                    el('button', {
                        class: 'cta',
                        type: 'button',
                        onclick: () => context.navigate('review', {
                            exhibitionId: record.exhibitionId || '',
                        }),
                    }, [t('s_j8kyoz')]),
                ]),
            ]),
        ]));

        if (ok) {
            toast(result.message || t('s_shfy40'), 'success');
        } else {
            toast(result?.error || t('s_1ibqo8o'), 'error');
        }
    }

    function detailRow(label, value) {
        return el('div', { class: 'row' }, [
            el('span', { class: 'row-meta', style: { minWidth: '84px' }, text: label }),
            el('strong', { class: 'fill', text: value || '—' }),
        ]);
    }

    /** 继续核销：清掉上一次的结果并重新取景。 */
    function restart() {
        replace(resultHost, []);
        replace(statusHost, []);
        const button = el('button', { class: 'cta', type: 'button' }, [t('s_wttsdb')]);
        button.addEventListener('click', () => startScan(button));
        replace(actionHost, [
            button,
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => openManualEntry(),
            }, [t('s_11elgkf')]),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate('exhibitor'),
            }, [t('s_dn4ida')]),
        ]);
        button.focus?.();
    }

    // ── 手动输入（摄像头不可用时的降级入口） ───────────────────────

    function openManualEntry() {
        const input = el('input', {
            class: 'input',
            id: 'checkin-code',
            type: 'text',
            placeholder: t('s_hdawan'),
            autocomplete: 'off',
        });
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
        const sheet = openSheet({
            title: t('s_11elgkf'),
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    el('div', { class: 'field' }, [
                        el('label', { for: input.id, text: t('s_zienpw') }),
                        input,
                        el('p', {
                            class: 'field-hint',
                            text: t('s_189gp0e'),
                        }),
                    ]),
                    errorBox,
                ]),
            ],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_guqe2t'),
                    variant: 'primary',
                    onClick: async (close) => {
                        const code = input.value.trim();
                        if (!code) {
                            errorBox.textContent = t('s_33a4b3');
                            errorBox.hidden = false;
                            return;
                        }
                        close();
                        replace(resultHost, []);
                        replace(stageHost, stateBlock({
                            iconName: 'check',
                            title: t('s_1yxjgeu'),
                            description: previewOf(code),
                        }));
                        await verify(code);
                    },
                },
            ],
        });
    }

    function noticeLine(text, tone = 'neutral') {
        return el('div', { class: 'notice', dataset: { tone } }, [el('span', { text })]);
    }
}
