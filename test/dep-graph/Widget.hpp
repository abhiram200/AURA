#ifndef WIDGET_HPP
#define WIDGET_HPP

#include <string>
#include <vector>

namespace MyApp {

class Widget {
public:
    Widget();
    Widget(const std::string& name);
    virtual ~Widget();

    std::string getName() const;
    void setName(const std::string& name);
    int getId() const;

    virtual void render() const;

protected:
    std::string name_;
    int id_;
    static int next_id_;
};

} // namespace MyApp

#endif /* WIDGET_HPP */