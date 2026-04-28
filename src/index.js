// Utils

const error = (msg) => {
    const error = document.getElementById("error");
    if (!error) return;

    error.textContent = "ERROR: " + msg;
    error.style.visibility = "visible";

    throw new Error(msg);
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const toUint = (v, min, max) => clamp(Math.round(v * max), min, max);

// Options

const FLOAT_SIZE = (() => {
    const url = new URL(location.href);
    const f = url.searchParams.get("f") || "16";

    const f8El = document.getElementById("f8");
    const f16El = document.getElementById("f16");
    const f32El = document.getElementById("f32");
    if (!f8El || !f16El || !f32El) error("No elements '#f8', '#f16', and '#f32'");

    const redirect = (f) => () => {
        url.searchParams.set("f", f);
        location.replace(url);
    };

    f8El.addEventListener("click", redirect(8));
    f16El.addEventListener("click", redirect(16));
    f32El.addEventListener("click", redirect(32));

    switch (f) {
        case "8":
            f8El.checked = true;
            return 8;
        case "16":
            f16El.checked = true;
            return 16;
        case "32":
            f32El.checked = true;
            return 32;
        default:
            error(`Invalid value (${f}) of search parameter 'f'`);
    }
})();

const FLOAT_RANGES = {
    8: 1 << 7,
    16: 1 << 14,
    32: 1 << 28,
};

const X_MIN = 0;
const X_MAX = FLOAT_RANGES[FLOAT_SIZE];
const Y_MIN = 0;
const Y_MAX = 1;

const ZOOM_SPEED = 0.9;

// Rendering

const canvas = document.getElementById("canvas");
if (!canvas) error("No element '#canvas'");

const ctx = canvas.getContext("2d");
if (!ctx) error("Canvas does not support context 2D");

let offsetX = 0;
let offsetY = 0;
let rangeX = X_MAX - X_MIN;
let rangeY = Y_MAX - Y_MIN;
let maxErrX = 0;
let maxErrY = 0;
let width, height, image, writeBuffer;
let brightness = 0.4;

{
    const brightnessEl = document.getElementById("brightness");
    if (!brightnessEl) error("No element '#brightness'");

    brightnessEl.value = brightness;
    brightnessEl.addEventListener("input", (event) => {
        brightness = event.target.value;
        render();
    });
}

const createFloatCast = (exponentBits, mantissaBits) => {
    if (exponentBits >= 11 || mantissaBits >= 20) {
        error(`Unsupported exponent (${exponentBits}) & mantissa (${mantissaBits})`);
    }

    const maxMantissa = (1 << mantissaBits) - 1;

    const minExponent = -(1 << (exponentBits - 1));
    const maxExponent = (1 << (exponentBits - 1)) - 1;

    const view = new DataView(new ArrayBuffer(8));
    return (x) => {
        if (x === 0) return 0;

        view.setFloat64(0, x, true);
        const upper = view.getUint32(4, true);

        const sign = upper >> 31 ? -1 : +1;
        let exponent = ((upper >> 20) & 0x7ff) - 1023;

        const mantissaF64 = upper & 0xfffff;
        let mantissa = mantissaF64 >> (20 - mantissaBits);
        if ((mantissaF64 >> (20 - mantissaBits - 1)) & 1) {
            mantissa += 1;

            if (mantissa > maxMantissa) {
                mantissa &= maxMantissa;
                exponent++;
            }
        }

        if (exponent < minExponent) {
            mantissa >>= minExponent - exponent;
            exponent = minExponent;
        }

        return sign * 2 ** exponent * (1 + mantissa / (1 << mantissaBits));
    };
};

const FLOAT_CASTS = {
    8: createFloatCast(4, 3),
    16: typeof Math.f16round === "function" ? Math.f16round : createFloatCast(5, 10),
    32: Math.fround,
};

const cast = FLOAT_CASTS[FLOAT_SIZE];

const screenToFloatX = (x) => Math.floor(offsetX + (x / width) * rangeX);
const screenToFloatY = (y) => offsetY + (y / height) * rangeY;

const floatToScreenX = (x) => ((x - offsetX) / rangeX) * width;
const floatToScreenY = (y) => ((y - offsetY) / rangeY) * height;

const getRoundingError = (x64, y64) => {
    const f16 = cast(x64 + y64);
    const x16 = Math.floor(f16);
    const y16 = f16 - x16;
    return [Math.abs(x64 - x16), Math.abs(y64 - y16)];
};

const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;

    canvas.width = width;
    canvas.height = height;

    image = ctx.createImageData(width, height);
    writeBuffer = new Uint32Array(image.data.buffer);
};

const computeMaxErr = () => {
    if (!width || !height) error("computeMaxErr called before resize");

    for (let y = 0; y < height; y++) {
        const y64 = screenToFloatY(y);
        for (let x = 0; x < width; x++) {
            const [errX, errY] = getRoundingError(screenToFloatX(x), y64);
            maxErrX = Math.max(maxErrX, errX);
            maxErrY = Math.max(maxErrY, errY);
        }
    }
    if (maxErrY < 1e-9) error("Difference between y values is too small");
};

const updateLabels = (() => {
    const yMinEl = document.getElementById("yMin");
    const yMaxEl = document.getElementById("yMax");
    const xMinEl = document.getElementById("xMin");
    const xMaxEl = document.getElementById("xMax");
    if (!yMinEl || !yMaxEl || !xMinEl || !xMaxEl) error("No axis labels");

    const yLabel = (y) => {
        const str = y.toString();
        if (str.length === 1) return str;
        return str.substring(1, 7);
    };

    const xLabel = (x) => Math.floor(x);

    return () => {
        yMinEl.textContent = yLabel(screenToFloatY(0));
        yMaxEl.textContent = yLabel(screenToFloatY(height));
        xMinEl.textContent = xLabel(screenToFloatX(0));
        xMaxEl.textContent = xLabel(screenToFloatX(width));
    };
})();

const render = () => {
    if (!width || !height || !image || !writeBuffer) error("Render called before resize");

    let i = 0;
    for (let y = 0; y < height; y++) {
        const y64 = screenToFloatY(height - 1 - y);
        for (let x = 0; x < width; x++) {
            const [errX, errY] = getRoundingError(screenToFloatX(x), y64);
            const normErr = maxErrX === 0 ? errY / maxErrY : (errX / maxErrX + errY / maxErrY) / 2;
            const intensity = toUint(normErr ** brightness, 0, 0xff);
            writeBuffer[i++] = 0xff000000 | (intensity << 16) | (intensity << 8) | intensity;
        }
    }
    ctx.putImageData(image, 0, 0);
};

resize();
computeMaxErr();
updateLabels();
render();

window.addEventListener("resize", () => {
    resize();
    render();
});

// Panning

{
    let panning = false;
    let startX = 0;
    let startY = 0;

    canvas.addEventListener("mouseup", () => (panning = false));
    canvas.addEventListener("mouseout", () => (panning = false));

    canvas.addEventListener("mousedown", (e) => {
        panning = true;
        startX = e.offsetX;
        startY = e.offsetY;
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!panning) return;

        const dx = -((e.offsetX - startX) / width) * rangeX;
        const dy = ((e.offsetY - startY) / height) * rangeY;

        offsetX = clamp(offsetX + dx, X_MIN, X_MAX - rangeX);
        offsetY = clamp(offsetY + dy, Y_MIN, Y_MAX - rangeY);

        startX = e.offsetX;
        startY = e.offsetY;

        updateLabels();
        render();
    });
}

// Zooming

{
    let zoom = 1;
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaX === 0 ? (e.deltaY === 0 ? e.deltaZ : e.deltaY) : e.deltaX;
        const mult = delta < 0 ? ZOOM_SPEED : 1 / ZOOM_SPEED;
        zoom = clamp(zoom * mult, 0.001, 1);

        const screenX = e.offsetX;
        const screenY = height - 1 - e.offsetY;

        const floatX = screenToFloatX(screenX);
        const floatY = screenToFloatY(screenY);

        rangeX = zoom * (X_MAX - X_MIN);
        rangeY = zoom * (Y_MAX - Y_MIN);

        const shiftX = ((floatToScreenX(floatX) - screenX) / width) * rangeX;
        const shiftY = ((floatToScreenY(floatY) - screenY) / height) * rangeY;

        offsetX = clamp(offsetX + shiftX, X_MIN, X_MAX - rangeX);
        offsetY = clamp(offsetY + shiftY, Y_MIN, Y_MAX - rangeY);

        updateLabels();
        render();
    });
}

// Info

{
    const NBSP = "\u00A0";

    const floatText = document.getElementById("float");
    const exactText = document.getElementById("exact");
    if (!floatText || !exactText) error("No elements '#float' and '#exact'");

    canvas.addEventListener("mousemove", (e) => {
        const x64 = screenToFloatX(e.offsetX);
        const y64 = screenToFloatY(height - 1 - e.offsetY);
        const f64 = x64 + y64;

        exactText.textContent = `Double: ${f64}`;
        floatText.textContent = `Float:${NBSP} ${cast(f64)}`;
    });
}

// Render time

const measureRenderTime = () => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 100; i++) {
        const start = Date.now();
        render();
        sum += Date.now() - start;
        count++;
    }
    console.log(`Render time: ${Math.round(sum / count)}ms`);
};

// measureRenderTime();
