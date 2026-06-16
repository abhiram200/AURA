#include <stdio.h>
#include <stdlib.h>
#include "utils.h"

#define MAX_POINTS 100

int main() {
    Point p = create_point(3, 4);
    print_point(p);
    return 0;
}