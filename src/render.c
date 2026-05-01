// Types

typedef int i32;
typedef long long i64;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef float f32;
typedef double f64;

static_assert(sizeof(i32) == 4);
static_assert(sizeof(i64) == 8);
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

void init(u32 _exponent_bits, u32 _mantissa_bits) {
    exponent_bits = _exponent_bits;
    mantissa_bits = _mantissa_bits;
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

void move(f64 _offset_x, f64 _offset_y, f64 _range_x, f64 _range_y) {
    offset_x = _offset_x;
    offset_y = _offset_y;
    range_x = _range_x;
    range_y = _range_y;
}

u32 *render() {
    for (u32 y = 0; y < height; y++) {
        for (u32 x = 0; x < width; x++) {
            image[y * width + x]
                = 0xFF000000 | ((u32) (x / (f64) width * 0xFF)) << 8 | ((u32) (y / (f64) height * 0xFF));
        }
    }
    return image;
}
