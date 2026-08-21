cmake_minimum_required(VERSION 3.24)

project(OrbitEngine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ORBIT_ENGINE_BUILD_TESTS "Build portable C++ tests" ON)
option(ORBIT_ENGINE_BUILD_NODE "Build the Node-API adapter" OFF)
option(ORBIT_ENGINE_BUILD_WASM "Build the Emscripten adapter" OFF)

set(ORBIT_ENGINE_NODE_INCLUDE_DIR "" CACHE PATH "Directory containing Node-API headers")
set(ORBIT_ENGINE_NODE_ADDON_API_DIR "" CACHE PATH "Directory containing node-addon-api")
set(ORBIT_ENGINE_NODE_OUTPUT_DIR "${CMAKE_BINARY_DIR}/prebuild" CACHE PATH "Native addon staging directory")
set(ORBIT_ENGINE_WASM_OUTPUT_DIR "${CMAKE_BINARY_DIR}/wasm" CACHE PATH "WASM artifact staging directory")

if(ORBIT_ENGINE_BUILD_NODE AND (NOT ORBIT_ENGINE_NODE_INCLUDE_DIR OR NOT ORBIT_ENGINE_NODE_ADDON_API_DIR))
  message(FATAL_ERROR "ORBIT_ENGINE_BUILD_NODE requires ORBIT_ENGINE_NODE_INCLUDE_DIR and ORBIT_ENGINE_NODE_ADDON_API_DIR")
endif()

if(ORBIT_ENGINE_BUILD_WASM AND NOT EMSCRIPTEN)
  message(FATAL_ERROR "ORBIT_ENGINE_BUILD_WASM requires the Emscripten CMake toolchain")
endif()

if(ORBIT_ENGINE_BUILD_TESTS)
  enable_testing()
endif()

add_subdirectory(cpp)
