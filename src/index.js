// Utils

const getElementsById = (...ids) => {
    return ids.map((id) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Cannot find element "#${id}"`);
        return element;
    });
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// Options

const FLOAT_SIZE = (() => {
    const url = new URL(location.href);

    const redirect = (f) => () => {
        url.searchParams.set("f", f);
        location.replace(url);
    };

    const [f8El, f16El, f32El] = getElementsById("f8", "f16", "f32");
    f8El.addEventListener("click", redirect(8));
    f16El.addEventListener("click", redirect(16));
    f32El.addEventListener("click", redirect(32));

    const f = url.searchParams.get("f") || "16";
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
            throw new Error(`Invalid value (${f}) of search parameter 'f'`);
    }
})();

const FLOAT_RANGES = {
    8: 1 << 7,
    16: 1 << 14,
    32: 1 << 27,
};

const X_MIN = 0;
const X_MAX = FLOAT_RANGES[FLOAT_SIZE];
const Y_MIN = 0;
const Y_MAX = 1;

const ZOOM_SPEED = 0.85;

// Rendering

const [canvas] = getElementsById("canvas");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas does not support context 2D");

let offsetX = 0;
let offsetY = 0;
let rangeX = X_MAX - X_MIN;
let rangeY = Y_MAX - Y_MIN;
let maxErrX = 0;
let maxErrY = 0;
let width, height, image, writeBuffer;
let brightness = 0.4;

{
    const [brightnessEl] = getElementsById("brightness");
    brightnessEl.value = brightness;
    brightnessEl.addEventListener("input", (event) => {
        brightness = event.target.value;
        render();
    });
}

const WASM_URL = "./render.wasm";

const loadWasm = async () => {
    const imports = {};
    const env = new Proxy(imports, {
        get: (obj, key) => {
            return (...args) => {
                if (!(key in obj)) throw new Error(`Uninitialized import "${key}"`);
                return obj[key](...args);
            };
        },
    });

    const { instance } = await WebAssembly.instantiateStreaming(fetch(WASM_URL), { env });

    const ptrToString = (ptr) => {
        const mem = new Uint8Array(instance.exports.memory.buffer);
        let end = ptr;
        while (mem[end] != 0) end++;
        return new TextDecoder().decode(mem.subarray(ptr, end));
    };

    imports.print = (ptr) => console.log(ptrToString(ptr));

    imports.error = (ptr) => {
        throw new Error(ptrToString(ptr));
    };

    imports.put_image_data = (ptr, width, height) => {
        const array = new Uint8ClampedArray(instance.exports.memory.buffer, ptr, width * height * 4);
        const image = new ImageData(array, width, height);
        ctx.putImageData(image, 0, 0);
    };

    return instance.exports;
};

const main = async () => {
    const {
        init,
        move,
        resize,
        render,
        round_float,
        screen_to_float_x,
        screen_to_float_y,
        float_to_screen_x,
        float_to_screen_y,
    } = await loadWasm();

    const updateLabels = (() => {
        const [yMinEl, yMaxEl, xMinEl, xMaxEl] = getElementsById("yMin", "yMax", "xMin", "xMax");

        const yLabel = (y) => {
            const str = y.toString();
            if (str.length === 1) return str;
            return str.substring(1, 7);
        };

        const xLabel = (x) => Math.floor(x);

        return () => {
            yMinEl.textContent = yLabel(screen_to_float_y(0));
            yMaxEl.textContent = yLabel(screen_to_float_y(height));
            xMinEl.textContent = xLabel(screen_to_float_x(0));
            xMaxEl.textContent = xLabel(screen_to_float_x(width));
        };
    })();

    init(
        ...{
            8: [4, 3],
            16: [5, 10],
            32: [8, 23],
        }[FLOAT_SIZE],
    );
    move(offsetX, offsetY, rangeX, rangeY);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    resize(width, height);
    render();

    updateLabels();

    window.addEventListener("resize", () => {
        width = canvas.clientWidth;
        height = canvas.clientHeight;

        canvas.width = width;
        canvas.height = height;

        resize(width, height);
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

            move(offsetX, offsetY, rangeX, rangeY);
            render();
            updateLabels();
        });
    }

    // Zooming

    {
        const MIN_ZOOM = 10 / (X_MAX - X_MIN);

        let zoom = 1;
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const delta = e.deltaX === 0 ? (e.deltaY === 0 ? e.deltaZ : e.deltaY) : e.deltaX;
            const mult = delta < 0 ? ZOOM_SPEED : 1 / ZOOM_SPEED;
            zoom = clamp(zoom * mult, MIN_ZOOM, 1);

            const screenX = e.offsetX;
            const screenY = height - 1 - e.offsetY;

            const floatX = screen_to_float_x(screenX);
            const floatY = screen_to_float_y(screenY);

            rangeX = zoom * (X_MAX - X_MIN);
            rangeY = zoom * (Y_MAX - Y_MIN);

            const shiftX = ((float_to_screen_x(floatX) - screenX) / width) * rangeX;
            const shiftY = ((float_to_screen_y(floatY) - screenY) / height) * rangeY;

            offsetX = clamp(offsetX + shiftX, X_MIN, X_MAX - rangeX);
            offsetY = clamp(offsetY + shiftY, Y_MIN, Y_MAX - rangeY);

            move(offsetX, offsetY, rangeX, rangeY);
            render();
            updateLabels();
        });
    }

    // Mouseover info

    {
        const TYPE_NAMES = {
            8: "Float8",
            16: "Half",
            32: "Single",
        };
        const TYPE = TYPE_NAMES[FLOAT_SIZE];

        const NBSP = "\u00A0";
        const SPACE = NBSP.repeat(6 - TYPE.length);

        const [floatEl, doubleEl] = getElementsById("float", "double");
        canvas.addEventListener("mousemove", (e) => {
            const x = screen_to_float_x(e.offsetX);
            const y = screen_to_float_y(height - 1 - e.offsetY);
            const f = x + y;

            doubleEl.textContent = `Double: ${f}`;
            floatEl.textContent = `${TYPE}:${SPACE} ${round_float(f)}`;
        });
    }
};

main().catch((e) => {
    const errorEl = document.getElementById("error");
    if (!errorEl) return;

    errorEl.textContent = "ERROR: " + e.message;
    errorEl.style.visibility = "visible";

    throw e;
});
