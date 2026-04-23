// Constants

const X_MIN = 0;
const X_MAX = 1 << 16;
const Y_MIN = 0;
const Y_MAX = 1;

// Utils

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const toF16 = (() => {
    let f = new Float16Array([0]);
    return (f64) => {
        f[0] = f64;
        return f[0];
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

let offsetX = 0;
let offsetY = 0;
let sizeX = X_MAX - X_MIN;
let sizeY = Y_MAX - Y_MIN;
let kX = 0;
let kY = 0;
let width, height, image;

const calibrate = () => {
    if (!width || !height) error("No width or height");

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const x64 = offsetX + (x / width) * sizeX;
            const y64 = offsetY + (y / height) * sizeY;

            const x16 = toF16(x64);
            const y16 = toF16(y64);

            const dx = Math.abs(x64 - x16);
            const dy = Math.abs(y64 - y16);

            kX = Math.max(kX, dx);
            kY = Math.max(kY, dy);
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

const render = () => {
    if (!width || !height || !image) error("No width, height, or image");

    const getPixelColor = (x, y) => {
        const x64 = offsetX + (x / width) * sizeX;
        const y64 = offsetY + (y / height) * sizeY;

        const x16 = toF16(x64);
        const y16 = toF16(y64);

        const i = (Math.abs(x64 - x16) / kX + Math.abs(y64 - y16) / kY) * 0xff;
        return [i, i, i];
    };

    let i = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = getPixelColor(x, y);
            image.data[i++] = r;
            image.data[i++] = g;
            image.data[i++] = b;
            image.data[i++] = 0xff;
        }
    }
    ctx.putImageData(image, 0, 0);
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

        const dx = ((startX - e.offsetX) / e.target.width) * sizeX;
        if (X_MIN <= offsetX + dx && offsetX + dx <= X_MAX - sizeX) offsetX += dx;
        startX = e.offsetX;

        // TODO: add speed?
        const dy = ((startY - e.offsetY) / e.target.height) * sizeY;
        if (Y_MIN <= offsetY + dy && offsetY + dy <= Y_MAX - sizeY) offsetY += dy;
        startY = e.offsetY;

        render();
    });
}

// Zooming

{
    let zoom = 1;
    canvas.addEventListener("wheel", (e) => {
        const delta = e.deltaX === 0 ? (e.deltaY === 0 ? e.deltaZ : e.deltaY) : e.deltaX;
        zoom = clamp(zoom + Math.sign(delta) * 0.05, 0.0001, 1);

        sizeX = zoom * (X_MAX - X_MIN);
        sizeY = zoom * (Y_MAX - Y_MIN);

        render();
    });
}

