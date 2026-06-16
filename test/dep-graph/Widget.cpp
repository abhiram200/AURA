#include "Widget.hpp"
#include <iostream>

namespace MyApp {

int Widget::next_id_ = 0;

Widget::Widget() : name_(""), id_(next_id_++) {}

Widget::Widget(const std::string& name) : name_(name), id_(next_id_++) {}

Widget::~Widget() {}

std::string Widget::getName() const {
    return name_;
}

void Widget::setName(const std::string& name) {
    name_ = name;
}

int Widget::getId() const {
    return id_;
}

void Widget::render() const {
    std::cout << "Widget: " << name_ << " (id=" << id_ << ")" << std::endl;
}

} // namespace MyApp