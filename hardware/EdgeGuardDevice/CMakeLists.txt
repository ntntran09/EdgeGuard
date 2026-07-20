cmake_minimum_required(VERSION 3.10.0)
project(opencvtest VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCV REQUIRED)

add_executable(opencvtest main.cpp)

target_include_directories(opencvtest PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(opencvtest PRIVATE ${OpenCV_LIBS})