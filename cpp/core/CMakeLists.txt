add_library(orbit_engine_core STATIC
  src/core.cpp
  src/frame.cpp
  src/object.cpp
  src/propagation.cpp
  src/time.cpp
)

target_include_directories(orbit_engine_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(orbit_engine_core PUBLIC cxx_std_20)
set_target_properties(orbit_engine_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
