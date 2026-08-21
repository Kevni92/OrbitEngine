add_subdirectory(core)

if(ORBIT_ENGINE_BUILD_TESTS)
  add_subdirectory(tests)
endif()

if(ORBIT_ENGINE_BUILD_NODE)
  add_subdirectory(bindings/node)
endif()

if(ORBIT_ENGINE_BUILD_WASM)
  add_subdirectory(bindings/wasm)
endif()
