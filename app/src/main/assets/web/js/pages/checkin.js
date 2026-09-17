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
import { scaffold, onPageStop } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, toast, openSheet } from '../ui/components.js';
import { el, replace } from '../core/dom.js';

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

    scaffold({
        title: '核销报名码',
        backTo: 'exhibitor',
        bodyProps: { 'data-gap': 'tight' },
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '扫码核销' }),
                el('span', { class: 'pill', text: '已参加' }),
            ]),
            el('p', {
                class: 'row-meta',
                text: '把用户报名详情里的报名码对准取景框，识别成功后会立即把该报名标记为“已参加”。',
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
        title: '准备扫码',
        description: '点击下方按钮开启摄像头取景，或直接手动输入报名码。',
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
            }, ['开启摄像头扫码']),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => openManualEntry(),
            }, ['手动输入报名码']),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate('exhibitor'),
            }, ['返回展商后台']),
        ]);
    }

    // ── 取景与识别 ─────────────────────────────────────────────────

    async function startScan(button) {
        if (scanning) {
            stopScan();
            return;
        }
        const supported = typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.getUserMedia === 'function';
        if (!supported) {
            replace(statusHost, [
                noticeLine('当前运行环境不支持摄像头扫码，请使用“手动输入报名码”。', 'error'),
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
                    noticeLine('未获得摄像头权限，可在系统设置里开启，或使用“手动输入报名码”。', 'error'),
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
        replace(statusHost, [noticeLine('正在开启摄像头…')]);
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
                audio: false,
            });
        } catch (error) {
            replace(stageHost, stateBlock({
                tone: 'error',
                iconName: 'image',
                title: '无法打开摄像头',
                description: `${error.message || '取景失败'}。可以改用“手动输入报名码”。`,
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
        replace(statusHost, [noticeLine('正在识别，请把报名码放进取景框。')]);
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
            title: '已停止扫码',
            description: '需要继续核销时再次开启摄像头，或手动输入报名码。',
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
        if (typeof window.jsQR !== 'function') {
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
        const found = window.jsQR(imageData.data, imageData.width, imageData.height, {
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
            title: '已识别报名码',
            description: previewOf(raw),
        }));
        await verify(raw);
    }

    function previewOf(raw) {
        const text = String(raw || '');
        if (text.startsWith(CODE_PREFIX)) {
            return '正在核对报名信息…';
        }
        return '这段内容不是本应用的报名码，请确认后重试。';
    }

    // ── 核销 ───────────────────────────────────────────────────────

    async function verify(raw) {
        submitting = true;
        replace(statusHost, loadingBlock(1));
        try {
            const result = await call('checkin.scan', { code: raw });
            renderResult(result, raw);
        } catch (error) {
            replace(resultHost, []);
            replace(statusHost, stateBlock({
                tone: 'error',
                title: '核销失败',
                description: error.message,
                action: { label: '继续扫码', onClick: () => restart() },
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
            detailRow('展会', record.exhibitionTitle || '—'),
            detailRow('报名人', record.visitorName || '—'),
            detailRow('报名时间', record.registrationTime || '—'),
            detailRow('报名信息', record.answers || '未收集额外信息'),
        ]);

        replace(resultHost, el('div', { class: 'stack' }, [
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: ok ? '核销成功' : '未能核销' }),
                    statusTag(ok ? '已参加' : (result?.status || '未通过'), ok ? 'ok' : 'danger'),
                ]),
                el('p', { class: 'row-meta', text: result?.message || result?.error || '' }),
                details,
                el('div', { class: 'grid-cols-2' }, [
                    el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => restart(),
                    }, ['继续扫码']),
                    el('button', {
                        class: 'cta',
                        type: 'button',
                        onclick: () => context.navigate('review', {
                            exhibitionId: record.exhibitionId || '',
                        }),
                    }, ['查看报名']),
                ]),
            ]),
        ]));

        if (ok) {
            toast(result.message || '核销成功', 'success');
        } else {
            toast(result?.error || '未能核销', 'error');
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
        const button = el('button', { class: 'cta', type: 'button' }, ['开启摄像头扫码']);
        button.addEventListener('click', () => startScan(button));
        replace(actionHost, [
            button,
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => openManualEntry(),
            }, ['手动输入报名码']),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate('exhibitor'),
            }, ['返回展商后台']),
        ]);
        button.focus?.();
    }

    // ── 手动输入（摄像头不可用时的降级入口） ───────────────────────

    function openManualEntry() {
        const input = el('input', {
            class: 'input',
            id: 'checkin-code',
            type: 'text',
            placeholder: '例如 CALMOBILE-CHECKIN|展会|报名',
            autocomplete: 'off',
        });
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
        const sheet = openSheet({
            title: '手动输入报名码',
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    el('div', { class: 'field' }, [
                        el('label', { for: input.id, text: '报名码内容' }),
                        input,
                        el('p', {
                            class: 'field-hint',
                            text: '可以让用户在报名详情页长按报名码复制，或直接输入二维码下方的文本。',
                        }),
                    ]),
                    errorBox,
                ]),
            ],
            actions: [
                { label: '取消', onClick: (close) => close() },
                {
                    label: '核销',
                    variant: 'primary',
                    onClick: async (close) => {
                        const code = input.value.trim();
                        if (!code) {
                            errorBox.textContent = '请输入报名码';
                            errorBox.hidden = false;
                            return;
                        }
                        close();
                        replace(resultHost, []);
                        replace(stageHost, stateBlock({
                            iconName: 'check',
                            title: '已提交报名码',
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
