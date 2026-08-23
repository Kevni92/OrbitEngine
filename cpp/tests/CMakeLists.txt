add_executable(orbit_engine_core_test
  core_test.cpp
)

target_link_libraries(orbit_engine_core_test PRIVATE orbit_engine_core)

add_test(NAME orbit_engine_core_test COMMAND orbit_engine_core_test)

add_executable(orbit_engine_oep_test
  oep_test.cpp
)

target_link_libraries(orbit_engine_oep_test PRIVATE orbit_engine_core)

add_test(NAME orbit_engine_oep_test COMMAND orbit_engine_oep_test)

add_executable(orbit_engine_numerical_test
  numerical_test.cpp
)

target_link_libraries(orbit_engine_numerical_test PRIVATE orbit_engine_core)

add_test(NAME orbit_engine_numerical_test COMMAND orbit_engine_numerical_test)

add_executable(orbit_engine_force_test
  force_test.cpp
)

target_link_libraries(orbit_engine_force_test PRIVATE orbit_engine_core)

add_test(NAME orbit_engine_force_test COMMAND orbit_engine_force_test)
