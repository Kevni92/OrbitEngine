add_library(orbit_engine_core STATIC
  src/core.cpp
  src/coupled.cpp
  src/coupled_operation.cpp
  src/frame.cpp
  src/frame_registry.cpp
  src/force.cpp
  src/numerical.cpp
  src/numerical_operation.cpp
  src/numerical_motion.cpp
  src/object.cpp
  src/oep.cpp
  src/propagation.cpp
  src/registry.cpp
  src/scheduler.cpp
  src/two_body.cpp
  src/lambert.cpp
  src/time.cpp
  src/thrust.cpp
)

target_include_directories(orbit_engine_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(orbit_engine_core PUBLIC cxx_std_20)
set_target_properties(orbit_engine_core PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(MSVC)
  target_compile_options(orbit_engine_core PRIVATE /fp:strict)
elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(orbit_engine_core PRIVATE -fno-fast-math -ffp-contract=off)
endif()
