const DEFAULT_FLOAT_SIZE = 16;

const FLOAT_INFO = {
    // size: display name, element id, exponent bits, mantissa bits, x max
    8: ["Float8", "f8", 4, 3, 1 << 7],
    16: ["Half", "f16", 5, 10, 1 << 14],
    // TODO: why 27 not 28
    32: ["Single", "f32", 8, 23, 1 << 27],
};

const DEFAULT_BRIGHTNESS = 0.5;

const ZOOM_SPEED = 0.85;
const ZOOM_MIN_X_RANGE = 5;

const WASM_URL = "./render.wasm";

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const getElementsById = (...ids) => {
    return ids.map((id) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Cannot find element "#${id}"`);
        return element;
    });
};

const getFloatInfo = () => {
    const url = new URL(location.href);
    const f = url.searchParams.get("f") || DEFAULT_FLOAT_SIZE;
    if (!(f in FLOAT_INFO)) throw new Error(`Invalid value (${f}) of search parameter 'f'`);
    return FLOAT_INFO[f];
};

const loadWasm = async (ctx) => {
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

    imports.pow = Math.pow;

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
    const [DISPLAY_NAME, SELECTED_ELEMENT_ID, EXPONENT_BITS, MANTISSA_BITS, X_MAX] = getFloatInfo();
    const Y_MAX = 1;

    const [canvas] = getElementsById("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas does not support context 2D");

    const {
        init,
        set_brightness,
        round_float,
        screen_to_float_x,
        screen_to_float_y,
        float_to_screen_x,
        float_to_screen_y,
        move,
        resize,
        render,
    } = await loadWasm(ctx);

    let offsetX = 0;
    let offsetY = 0;
    let rangeX = X_MAX;
    let rangeY = Y_MAX;
    let width, height;

    // Float buttons controller
    {
        const redirect = (f) => () => {
            const url = new URL(location.href);
            url.searchParams.set("f", f);
            location.replace(url);
        };

        const [f8El, f16El, f32El] = getElementsById("f8", "f16", "f32");
        f8El.addEventListener("click", redirect(8));
        f16El.addEventListener("click", redirect(16));
        f32El.addEventListener("click", redirect(32));

        const [selected] = getElementsById(SELECTED_ELEMENT_ID);
        selected.checked = true;
    }

    // Brightness controller
    {
        const [brightnessEl] = getElementsById("brightness");
        brightnessEl.value = DEFAULT_BRIGHTNESS;
        brightnessEl.addEventListener("input", (event) => {
            set_brightness(event.target.value);
            render();
        });
    }

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

            offsetX = clamp(offsetX + dx, 0, X_MAX - rangeX);
            offsetY = clamp(offsetY + dy, 0, Y_MAX - rangeY);

            startX = e.offsetX;
            startY = e.offsetY;

            move(offsetX, offsetY, rangeX, rangeY);
            render();
            updateLabels();
        });
    }

    // Zooming
    {
        const MIN_ZOOM = ZOOM_MIN_X_RANGE / X_MAX;

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

            rangeX = zoom * X_MAX;
            rangeY = zoom * Y_MAX;

            const shiftX = ((float_to_screen_x(floatX) - screenX) / width) * rangeX;
            const shiftY = ((float_to_screen_y(floatY) - screenY) / height) * rangeY;

            offsetX = clamp(offsetX + shiftX, 0, X_MAX - rangeX);
            offsetY = clamp(offsetY + shiftY, 0, Y_MAX - rangeY);

            move(offsetX, offsetY, rangeX, rangeY);
            render();
            updateLabels();
        });
    }

    // Mouseover info
    {
        const NBSP = "\u00A0";
        const SPACE = NBSP.repeat(6 - DISPLAY_NAME.length);

        const [floatEl, doubleEl] = getElementsById("float", "double");
        canvas.addEventListener("mousemove", (e) => {
            const x = screen_to_float_x(e.offsetX);
            const y = screen_to_float_y(height - 1 - e.offsetY);
            const f = x + y;

            doubleEl.textContent = `Double: ${f}`;
            floatEl.textContent = `${DISPLAY_NAME}:${SPACE} ${round_float(f)}`;
        });
    }

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

    init(EXPONENT_BITS, MANTISSA_BITS);
    set_brightness(DEFAULT_BRIGHTNESS);
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
};

main().catch((e) => {
    const errorEl = document.getElementById("error");
    if (!errorEl) return;

    errorEl.textContent = "ERROR: " + e.message;
    errorEl.style.visibility = "visible";

    throw e;
});
