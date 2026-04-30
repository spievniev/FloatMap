typedef int i32;
typedef unsigned int u32;
typedef double f64;

extern void print(const char *);
__attribute__((noreturn)) extern void error(const char *);

#define _STRINGIFY(x) #x
#define STRINGIFY(x) _STRINGIFY(x)

#define ASSERT(condition)                                                                      \
    do {                                                                                       \
        if (!(condition)) error("Assert failed at line " STRINGIFY(__LINE__) ": " #condition); \
    } while (0)

f64 render(f64 x) {
    ASSERT(sizeof(i32) == 4);
    ASSERT(sizeof(u32) == 4);
    ASSERT(sizeof(f64) == 8);

    return x;
}
