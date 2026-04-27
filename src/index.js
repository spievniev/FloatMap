
const error = (msg) => {
    const error = document.getElementById("error");
    if (!error) return;

    error.textContent = "ERROR: " + msg;
    error.style.visibility = "visible";

    throw new Error(msg);
};

// Options

const F16 = (() => {
    const url = new URL(location.href);
    const f = url.searchParams.get("f");
    if (f && f !== "16" && f !== "32") error("Invalid value of parameter 'f'");

    const f16 = !f || f === "16";

    const f16El = document.getElementById("f16");
    const f32El = document.getElementById("f32");
    if (!f16El || !f32El) error("No elements '#f16' and '#f32'");

    if (f16) {
        f16El.checked = true;
        f32El.addEventListener("click", () => {
            url.searchParams.set("f", 32);
            location.replace(url);
        });
    } else {
        f32El.checked = true;
        f16El.addEventListener("click", () => {
            url.searchParams.set("f", 16);
            location.replace(url);
        });
    }

    return f16;
})();

const X_MIN = 0;
const X_MAX = F16 ? 1 << 14 : 1 << 28;
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

const round = (() => {
    const arr = new (F16 ? Float16Array : Float32Array)([0]);
    return (f64) => {
        arr[0] = f64;
        return arr[0];
    };
})();

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
