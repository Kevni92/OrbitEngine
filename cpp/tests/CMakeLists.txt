add_executable(orbit_engine_core_test
  core_test.cpp
)

target_link_libraries(orbit_engine_core_test PRIVATE orbit_engine_core)

add_test(NAME orbit_engine_core_test COMMAND orbit_engine_core_test)
