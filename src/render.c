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

extern void print(const char *);
[[noreturn]] extern void error(const char *);
extern void put_image_data(u32 *, u32, u32);

#define _STRINGIFY(x) #x
#define STRINGIFY(x) _STRINGIFY(x)

#define ASSERT(condition)                                                                      \
    do {                                                                                       \
        if (!(condition)) error("Assert failed at line " STRINGIFY(__LINE__) ": " #condition); \
    } while (0)

static const f64 APPROXIMATION_THRESHOLD = 0.25;

static u32 exponent_bits = 0, mantissa_bits = 0;
static f64 brightness_m = 0, brightness_b = 0;
static f64 brightness = 0.0;
static f64 offset_x = 0.0, offset_y = 0.0;
static f64 range_x = 0.0, range_y = 0.0;
static u32 width = 0, height = 0;
static f64 max_error_x = 0.0, max_error_y = 0.0;
static u64 image_size_pages = 0;
static u32 *image;

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

// Approximation of power fuction for x in [0, 1], y in [0.1, 1] with precision of 1/256.
static f64 pow01(f64 x, f64 y) {
    if (x == 0 || x == 1 || y == 1) return x;
    if (y == 0.5) return __builtin_sqrt(x);

    const f64 LN_2 = 0.69314718055994528622676398299518041312694549560546875;

    u64 bits = *(u64 *) &x;
    i32 e = ((bits >> 52) & 0x7FF) - 1023;

    // Exponent is so small that for any y the result is rounded to 0.
    if (e <= -80) return 0;

    // Get mantissa as double by setting exponent to 0.
    bits = (bits & 0x000FFFFFFFFFFFFFULL) | 0x3FF0000000000000ULL;
    f64 m = *(f64 *) &bits;

    // The goal is to find x^y, which can be rewritten as e^(ln(x) * y).
    // Compute ln(x):
    // Double can be written as      x = 2^e * m, m in [1, 2)
    // Then                      ln(x) = e * ln(2) + ln(m)
    // Rewrite m to reduce range     u = (m - 1) / (m + 1), u in [0, 1/3)
    // And                           m = (1 + u) / (1 - u)
    // Then                      ln(m) = ln(1 + u) - ln(1 - u)
    // Compute ln(1 + u) - ln(1 - u) using Taylor series factored with Horner's method.
    f64 u = (m - 1) / (m + 1);
    f64 v = u * u;
    f64 ln_m = 2 * u * (1 + v * (1 / 3.0 + v * (1 / 5.0)));
    f64 ln_x = e * LN_2 + ln_m;

    // Compute e^(ln(x) * y):
    // Let                    t = ln(x) * y, t in (-inf, 0]
    // Rewrite the exponent   t = k * ln(2) + r, k is negative integer, |r| <= ln(2)/2
    // Then                 e^t = 2^k * e^r
    // Where                  k = round(t / ln(2)) = ceil(t / ln(2) - 0.5)
    // And                    r = t - k * ln(2)
    // Since k is negative integer, truncation acts as an implicit ceil.
    // Integer power of 2 is just a shift and now exponential is computed on a value with smaller range.
    // Compute e^r using Taylor series factored with Horner's method.
    f64 t = y * ln_x;
    i64 k = t / LN_2 - 0.5;
    f64 r = t - k * LN_2;
    f64 exp_r = 1 + r * (1 + r * (1 / 2.0 + r * (1 / 6.0 + r * (1 / 24.0))));

    // Compute 2^k * e^r by directly adding k to the exponent field.
    bits = *((u64 *) &exp_r) + (((u64) k) << 52);
    return *(f64 *) &bits;
}

f64 round_float(f64 x) {
    if (x == 0) return 0;
    if (exponent_bits == 8 && mantissa_bits == 23) return (f32) x;

    if (exponent_bits > 8) error("Unsupported exponent");
    if (mantissa_bits > 19) error("Unsupported mantissa");

    i32 max_exponent = (1 << (exponent_bits - 1)) - 1;
    i32 min_exponent = 1 - max_exponent;
    i32 min_subnormal_exponent = min_exponent - mantissa_bits;
    u32 max_mantissa = (1 << mantissa_bits) - 1;

    u32 upper = *((u64 *) &x) >> 32;

    u32 sign = upper & (1 << 31);
    i32 exponent = ((upper >> 20) & 0x7FF) - 1023;
    u32 mantissa = (upper & 0xFFFFF) >> (20 - mantissa_bits);

    // Round up if the next mantissa bit is set.
    if (upper & (1 << (20 - mantissa_bits - 1))) {
        mantissa++;

        if (mantissa > max_mantissa) {
            mantissa = 0;
            exponent++;
        }
    }

    if (exponent > max_exponent) {
        exponent = max_exponent;
        mantissa = max_mantissa;
    } else if (exponent < min_subnormal_exponent) {
        // Less than subnormal, round either to 0 or to the minimum value.
        f64 min_value = 1.0 / (1 << -min_subnormal_exponent);
        exponent = x > min_value / 2 ? min_subnormal_exponent : -1023;
        mantissa = 0;
    } else if (exponent < min_exponent) {
        // Subnormal value.
        u32 shift = min_exponent - exponent;
        if ((mantissa >> (shift - 1)) & 1) {
            // Round up: include implicit 1, shift, increment.
            mantissa = (((1 << mantissa_bits) | mantissa) >> shift) + 1;
            exponent = min_exponent;
            // Normalize back to implicit one form.
            while ((mantissa & (1 << mantissa_bits)) == 0) {
                mantissa <<= 1;
                exponent--;
            }
            mantissa &= ~(1 << mantissa_bits);
        } else {
            // Clear truncated bits.
            mantissa &= ~((1 << shift) - 1);
        }
    }

    u32 out_upper = sign | ((exponent + 1023) << 20) | (mantissa << (20 - mantissa_bits));
    u64 out = ((u64) out_upper) << 32;
    return *((f64 *) &out);
}

f64 screen_to_float_x(u32 x) { return floor(offset_x + (x / (f64) width) * range_x); }
f64 screen_to_float_y(u32 y) { return offset_y + (y / (f64) height) * range_y; }

f64 float_to_screen_x(f64 x) { return (x - offset_x) / range_x * width; }
f64 float_to_screen_y(f64 y) { return (y - offset_y) / range_y * height; }

void set_float_info(u32 _exponent_bits, u32 _mantissa_bits) {
    exponent_bits = _exponent_bits;
    mantissa_bits = _mantissa_bits;
}

void set_brightness(f64 _brightness) {
    brightness = _brightness;
    // Calculate coefficients for linear approximation.
    brightness_m = (1 - pow01(APPROXIMATION_THRESHOLD, brightness)) / (1 - APPROXIMATION_THRESHOLD);
    brightness_b = 1 - brightness_m;
}

void set_offset(f64 _offset_x, f64 _offset_y) {
    offset_x = _offset_x;
    offset_y = _offset_y;
}

void set_range(f64 _range_x, f64 _range_y) {
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
    ASSERT(max_error_x != 0 && max_error_y > 1e-9);
}

void set_size(u32 _width, u32 _height) {
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

static u8 compute_intensity(f64 error) {
    if (error < APPROXIMATION_THRESHOLD) {
        // Use power function to expand lower values.
        return pow01(error, brightness) * 0xFF;
    } else {
        // Compressed upper values are approximated with a linear function to improve performance.
        return (brightness_m * error + brightness_b) * 0xFF;
    }
}

void render() {
    ASSERT(width != 0 && height != 0 && range_x != 0 && range_y != 0 && max_error_x != 0 && max_error_y != 0
           && brightness != 0);

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
            f64 error = (error_x / max_error_x + error_y / max_error_y) / 2;

            u8 intensity = compute_intensity(error);
            image[i++] = 0xFF000000 | (intensity << 16) | (intensity << 8) | intensity;
        }
    }
    put_image_data(image, width, height);
}
