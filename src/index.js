
const error = (msg) => {
    const error = document.getElementById("error");
    if (!error) return;

    error.textContent = "ERROR: " + msg;
    error.style.visibility = "visible";

    throw new Error(msg);
};

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
let dxMax = 0;
let dyMax = 0;
let width, height, image, writeBuffer;
let brightness = 0.4;

const brightnessEl = document.getElementById("brightness");
if (!brightnessEl) error("No element '#brightness'");

brightnessEl.value = brightness;
brightnessEl.addEventListener("input", (event) => {
    brightness = event.target.value;
    render();
});

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const createFloatCast = (exponentBits, mantissaBits) => {
    if (exponentBits >= 11 || mantissaBits >= 20) {
        error(`Unsupported exponent (${exponentBits}) & mantissa (${mantissaBits})`);
    }

    const inputF64 = new Float64Array([0]);
    const inputU32 = new Uint32Array(inputF64.buffer);
    const outputU32 = new Uint32Array([0, 0]);
    const outputF64 = new Float64Array(outputU32.buffer);

    return (x) => {
        inputF64[0] = x;
        const upper = inputU32[1];

        const sign = upper & (1 << 31);
        let exponent = ((upper >> 20) & 0x7ff) - 1023;

        const mantissaF64 = upper & 0xfffff;
        let mantissa = mantissaF64 >> (20 - mantissaBits);
        if ((mantissaF64 >> (20 - mantissaBits - 1)) & 1) {
            mantissa += 1;

            const maxMantissa = (1 << mantissaBits) - 1;
            if (mantissa > maxMantissa) {
                mantissa &= maxMantissa;
                exponent++;
            }
        }

        const minExponent = -(1 << (exponentBits - 1));
        const maxExponent = (1 << (exponentBits - 1)) - 1;
        if (exponent < minExponent) {
            mantissa >>= minExponent - exponent;
            exponent = minExponent;
        }
        if (exponent > maxExponent) error(`Exponent too large: ${exponent} > ${maxExponent}`);

        outputU32[1] = sign | ((exponent + 1023) << 20) | (mantissa << (20 - mantissaBits));
        return outputF64[0];
    };
};

const FLOAT_CASTS = {
    8: createFloatCast(4, 3),
    16: createFloatCast(5, 10),
    32: (() => {
        const arr = new Float32Array([0]);
        return (f64) => {
            arr[0] = f64;
            return arr[0];
        };
    })(),
};

const round = FLOAT_CASTS[FLOAT_SIZE];

const screenToFloatX = (x) => Math.floor(offsetX + (x / width) * rangeX);
const screenToFloatY = (y) => offsetY + (y / height) * rangeY;

const floatToScreenX = (x) => ((x - offsetX) / rangeX) * width;
const floatToScreenY = (y) => ((y - offsetY) / rangeY) * height;

const floatToDiff = (x64, y64) => {
    const f16 = round(x64 + y64);
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

const calibrate = () => {
    if (!width || !height) error("Calibrate called before resize");

    for (let y = 0; y < height; y++) {
        const y64 = screenToFloatY(y);
        for (let x = 0; x < width; x++) {
            const [dx, dy] = floatToDiff(screenToFloatX(x), y64);
            dxMax = Math.max(dxMax, dx);
            dyMax = Math.max(dyMax, dy);
        }
    }
    if (dyMax < 1e-9) error("Difference between y values is too small");
};

const updateLabels = (() => {
    const yMinEl = document.getElementById("yMin");
    const yMaxEl = document.getElementById("yMax");
    const xMinEl = document.getElementById("xMin");
    const xMaxEl = document.getElementById("xMax");
    if (!yMinEl || !yMaxEl || !xMinEl || !xMaxEl) error("No axis labels");

    return () => {
        const yLabel = (y) => {
            const str = y.toString();
            if (str.length === 1) return str;
            return str.substring(1, 7);
        };

        const xLabel = (x) => Math.floor(x);

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
            const [dx, dy] = floatToDiff(screenToFloatX(x), y64);
            const d = dxMax === 0 ? dy / dyMax : (dx / dxMax + dy / dyMax) / 2;
            const v = clamp(Math.pow(d, brightness), 0, 1) * 0xff;
            writeBuffer[i++] = 0xff000000 | (v << 16) | (v << 8) | v;
        }
    }
    ctx.putImageData(image, 0, 0);
};

resize();
calibrate();
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

const floatText = document.getElementById("float");
const exactText = document.getElementById("exact");
if (!floatText || !exactText) error("No elements '#float' and '#exact'");

canvas.addEventListener("mousemove", (e) => {
    const x64 = screenToFloatX(e.offsetX);
    const y64 = screenToFloatY(height - 1 - e.offsetY);
    const f64 = x64 + y64;
    const f16 = round(f64);

    exactText.textContent = `Exact: ${f64}`;
    floatText.textContent = `Float: ${f16}`;
});

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

