// Types

typedef int i32;
typedef unsigned int u32;
typedef long long i64;
typedef unsigned long long u64;
typedef double f64;

// JS functions

extern void print(const char *);
__attribute__((noreturn)) extern void error(const char *);

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

static u32 float_size;
static f64 offset_x, offset_y;
static f64 range_x, range_y;
static u32 width, height;
static u32 *image;
static u64 image_size_pages = 0;

void init(u32 _float_size) {
    ASSERT(sizeof(i32) == 4);
    ASSERT(sizeof(u32) == 4);
    ASSERT(sizeof(i64) == 8);
    ASSERT(sizeof(u64) == 8);
    ASSERT(sizeof(f64) == 8);

    float_size = _float_size;
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

u32 *render(void) {
    for (u32 y = 0; y < height; y++) {
        for (u32 x = 0; x < width; x++) {
            image[y * width + x]
                = 0xFF000000 | ((u32) (x / (f64) width * 0xFF)) << 8 | ((u32) (y / (f64) height * 0xFF));
        }
    }
    return image;
}
