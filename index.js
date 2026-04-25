// Constants

const NBSP = "\u00A0";

const X_MIN = 0;
const X_MAX = 1 << 16;
const Y_MIN = 0;
const Y_MAX = 1;

// Utils

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const round = (() => {
    const arr = new Float16Array([0]);
    return (f64) => {
        arr[0] = f64;
        return arr[0];
    };
})();

const error = (msg) => {
    const error = document.getElementById("error");
    if (!error) return;

    error.textContent = "ERROR: " + msg;
    error.style.visibility = "visible";

    throw new Error(msg);
};

// Rendering

const canvas = document.getElementById("canvas");
if (!canvas) error("No canvas");

const ctx = canvas.getContext("2d");
if (!ctx) error("No context 2D");

const yMinEl = document.getElementById("yMin");
const yMaxEl = document.getElementById("yMax");
const xMinEl = document.getElementById("xMin");
const xMaxEl = document.getElementById("xMax");
if (!yMinEl || !yMaxEl || !xMinEl || !xMaxEl) error("No axis labels");

let offsetX = 0;
let offsetY = 0;
let sizeX = X_MAX - X_MIN;
let sizeY = Y_MAX - Y_MIN;
let kx = 0;
let ky = 0;
let width, height, image;

const posToFloat = (x, y) => {
    return [offsetX + (x / width) * sizeX, offsetY + (y / height) * sizeY];
};

const posToDiff = (x, y) => {
    const [x64, y64] = posToFloat(x, y);
    return [Math.abs(x64 - round(x64)), Math.abs(y64 - round(y64))];
};

const calibrate = () => {
    if (!width || !height) error("No width or height");

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [dx, dy] = posToDiff(x, y);
            kx = Math.max(kx, dx);
            ky = Math.max(ky, dy);
        }
    }
};

const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;

    canvas.width = width;
    canvas.height = height;

    image = ctx.createImageData(width, height);
};

const yLabel = (y) => {
    const str = y.toString();
    if (str.length === 1) return str;
    return str.substring(1, 7);
};

const xLabel = (x) => Math.floor(x);

const render = () => {
    if (!width || !height || !image) error("No width, height, or image");

    const getPixelColor = (x, y) => {
        const [dx, dy] = posToDiff(x, y);
        const d = (dx / kx + dy / ky) / 2;

        const v = d * 0xff;
        return [v, v, v];
    };

    let i = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = getPixelColor(x, height - 1 - y);
            image.data[i++] = r;
            image.data[i++] = g;
            image.data[i++] = b;
            image.data[i++] = 0xff;
        }
    }
    ctx.putImageData(image, 0, 0);

    yMinEl.textContent = yLabel(offsetY);
    yMaxEl.textContent = yLabel(offsetY + sizeY);
    xMinEl.textContent = xLabel(offsetX);
    xMaxEl.textContent = xLabel(offsetX + sizeX);
};

resize();
calibrate();
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

        const dx = -((e.offsetX - startX) / e.target.width) * sizeX;
        const dy = ((e.offsetY - startY) / e.target.height) * sizeY;

        offsetX = clamp(offsetX + dx, X_MIN, X_MAX - sizeX);
        offsetY = clamp(offsetY + dy, Y_MIN, Y_MAX - sizeY);

        startX = e.offsetX;
        startY = e.offsetY;

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
        zoom = clamp(zoom + Math.sign(delta) * 0.05, 0.0001, 1);

        sizeX = zoom * (X_MAX - X_MIN);
        sizeY = zoom * (Y_MAX - Y_MIN);

        render();
    });
}

// Info

const floatText = document.getElementById("float");
const exactText = document.getElementById("exact");
if (!floatText || !exactText) error("No text output");

canvas.addEventListener("mousemove", (e) => {
    const [x64, y64] = posToFloat(e.offsetX, height - 1 - e.offsetY);

    const strX16 = round(x64).toString();
    const strX64 = x64.toString();

    floatText.textContent = `Float: ${strX16 + NBSP.repeat(strX64.length - strX16.length)} ${round(y64)}`;
    exactText.textContent = `Exact: ${strX64} ${y64}`;
});
