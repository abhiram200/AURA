#ifndef CONTAINER_HPP
#define CONTAINER_HPP

#include "Widget.hpp"
#include <vector>
#include <memory>

namespace MyApp {

class Container : public Widget {
public:
    Container();
    Container(const std::string& name);

    void addChild(std::shared_ptr<Widget> child);
    void removeChild(int id);
    void render() const override;

private:
    std::vector<std::shared_ptr<Widget>> children_;
};

enum class Layout { Horizontal, Vertical, Grid };

} // namespace MyApp

#endif /* CONTAINER_HPP */