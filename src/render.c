// Types

typedef int i32;
typedef long long i64;
typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef float f32;
typedef double f64;

static_assert(sizeof(i32) == 4);
static_assert(sizeof(i64) == 8);
static_assert(sizeof(u8) == 1);
static_assert(sizeof(u32) == 4);
static_assert(sizeof(u64) == 8);
static_assert(sizeof(f32) == 4);
static_assert(sizeof(f64) == 8);

// JS functions

extern void print(const char *);
[[noreturn]] extern void error(const char *);

// Assert

#define _STRINGIFY(x) #x
#define STRINGIFY(x) _STRINGIFY(x)

#define ASSERT(condition)                                                                      \
    do {                                                                                       \
        if (!(condition)) error("Assert failed at line " STRINGIFY(__LINE__) ": " #condition); \
    } while (0)

// Utils

static inline f64 max(f64 a, f64 b) { return a > b ? a : b; }
static inline f64 abs(f64 x) { return x < 0 ? -x : x; }

static inline f64 floor(f64 f) {
    // All doubles above 2^53 are already integers.
    if (abs(f) >= (1LL << 53)) return f;
    i64 i = f;
    return i < 0 && i != f ? i - 1 : i;
}

static inline f64 ceil(f64 f) {
    // All doubles above 2^53 are already integers.
    if (abs(f) >= (1LL << 53)) return f;
    i64 i = f;
    return i > 0 && i != f ? i + 1 : i;
}

// State

static u32 exponent_bits, mantissa_bits;
static f64 offset_x, offset_y;
static f64 range_x, range_y;
static u32 width, height;
static f64 max_error_x, max_error_y;
static u32 *image;
static u64 image_size_pages = 0;

f64 round_float(f64 x) {
    if (exponent_bits == 8 && mantissa_bits == 23) return (f32) x;

    if (exponent_bits > 10) error("Unsupported exponent");
    if (mantissa_bits > 19) error("Unsupported mantissa");

    i32 min_exponent = -(1 << (exponent_bits - 1));
    i32 max_exponent = (1 << (exponent_bits - 1)) - 1;
    u32 max_mantissa = (1 << mantissa_bits) - 1;

    u32 upper = *((u64 *) &x) >> 32;

    u32 sign = upper & (1 << 31);
    i32 exponent = ((upper >> 20) & 0x7FF) - 1023;
    u32 mantissa = (upper & 0xFFFFF) >> (20 - mantissa_bits);

    if (upper & (1 << (20 - mantissa_bits - 1))) {
        mantissa++;

        if (mantissa > max_mantissa) {
            mantissa = 0;
            exponent++;
        }
    }

    if (exponent < min_exponent) {
        mantissa >>= min_exponent - exponent;
        exponent = min_exponent;
    } else if (exponent > max_exponent) {
        mantissa = max_mantissa;
        exponent = max_exponent;
    }

    u32 out_upper = sign | ((exponent + 1023) << 20) | (mantissa << (20 - mantissa_bits));
    u64 out = ((u64) out_upper) << 32;
    return *((f64 *) &out);
}

f64 screen_to_float_x(u32 x) { return floor(offset_x + (x / (f64) width) * range_x); }
f64 screen_to_float_y(u32 y) { return offset_y + (y / (f64) height) * range_y; }

void init(u32 _exponent_bits, u32 _mantissa_bits) {
    exponent_bits = _exponent_bits;
    mantissa_bits = _mantissa_bits;
}

void move(f64 _offset_x, f64 _offset_y, f64 _range_x, f64 _range_y) {
    offset_x = _offset_x;
    offset_y = _offset_y;
    range_x = _range_x;
    range_y = _range_y;
}

static void compute_max_error() {
    ASSERT(width != 0 && height != 0 && range_x != 0 && range_y != 0);

    max_error_x = max_error_y = 0;
    for (u32 screen_y = 0; screen_y < height; screen_y++) {
        f64 y = screen_to_float_y(screen_y);
        for (u32 screen_x = 0; screen_x < width; screen_x++) {
            f64 x = screen_to_float_x(screen_x);

            f64 rounded = round_float(x + y);
            f64 rounded_x = floor(rounded);
            f64 rounded_y = rounded - rounded_x;

            f64 error_x = abs(x - rounded_x);
            f64 error_y = abs(y - rounded_y);

            max_error_x = max(max_error_x, error_x);
            max_error_y = max(max_error_y, error_y);
        }
    }
    if (max_error_y < 1e-9) error("Maximum Y error is too small");
}

void resize(u32 _width, u32 _height) {
    const u64 PAGE_SIZE = 64 * 1024;

    width = _width;
    height = _height;

    // Allocation assumes that the memory is only used by the image.
    u32 new_size_pages = ceil((width * height * sizeof(*image)) / (f64) PAGE_SIZE);
    if (new_size_pages > image_size_pages) {
        u64 result = __builtin_wasm_memory_grow(0, new_size_pages - image_size_pages);
        ASSERT(result != -1LLU);
        if (image_size_pages == 0) image = (u32 *) (result * PAGE_SIZE);
        image_size_pages = new_size_pages;
    }

    compute_max_error();
}

u32 *render() {
    ASSERT(width != 0 && height != 0 && range_x != 0 && range_y != 0);

    u32 i = 0;
    for (u32 screen_y = 0; screen_y < height; screen_y++) {
        f64 y = screen_to_float_y(height - 1 - screen_y);
        for (u32 screen_x = 0; screen_x < width; screen_x++) {
            f64 x = screen_to_float_x(screen_x);

            f64 rounded = round_float(x + y);
            f64 rounded_x = floor(rounded);
            f64 rounded_y = rounded - rounded_x;

            f64 error_x = abs(x - rounded_x);
            f64 error_y = abs(y - rounded_y);
            f64 normal_error
                = max_error_x == 0 ? error_y / max_error_y : (error_x / max_error_x + error_y / max_error_y) / 2;

            u8 intensity = normal_error * 0xFF;
            image[i++] = 0xFF000000 | (intensity << 16) | (intensity << 8) | intensity;
        }
    }
    return image;
}
