#include <stdio.h>
#include <stdlib.h>
#include "utils.h"

static int counter = 0;

Point create_point(int x, int y) {
    Point p;
    p.x = x;
    p.y = y;
    return p;
}

int compare_points(const void* a, const void* b) {
    const Point* pa = (const Point*)a;
    const Point* pb = (const Point*)b;
    return (pa->x + pa->y) - (pb->x + pb->y);
}

void print_point(Point p) {
    printf("Point(%d, %d)\n", p.x, p.y);
}