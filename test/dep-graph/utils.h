#ifndef UTILS_H
#define UTILS_H

#include <stddef.h>

typedef struct {
    int x;
    int y;
} Point;

typedef int (*Comparator)(const void*, const void*);

enum Color {
    RED,
    GREEN,
    BLUE
};

Point create_point(int x, int y);
int compare_points(const void* a, const void* b);
void print_point(Point p);

#endif /* UTILS_H */