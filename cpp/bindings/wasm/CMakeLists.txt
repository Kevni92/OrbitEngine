add_executable(orbit_engine_wasm
  wasm_binding.cpp
)

target_link_libraries(orbit_engine_wasm PRIVATE orbit_engine_core)

target_link_options(orbit_engine_wasm PRIVATE
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sENVIRONMENT=web,node"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sEXPORTED_FUNCTIONS=['_orbit_engine_binding_protocol_version','_orbit_engine_core_version','_orbit_engine_health']"
  "--no-entry"
)

set_target_properties(orbit_engine_wasm PROPERTIES
  OUTPUT_NAME "orbit_engine_wasm"
  RUNTIME_OUTPUT_DIRECTORY "${ORBIT_ENGINE_WASM_OUTPUT_DIR}"
  SUFFIX ".js"
)
