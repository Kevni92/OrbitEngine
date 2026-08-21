add_library(orbit_engine_node MODULE
  addon.cpp
)

target_link_libraries(orbit_engine_node PRIVATE orbit_engine_core)

target_include_directories(orbit_engine_node
  PRIVATE
    ${ORBIT_ENGINE_NODE_INCLUDE_DIR}
    ${ORBIT_ENGINE_NODE_ADDON_API_DIR}
)

target_compile_definitions(orbit_engine_node PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS)

if(MSVC)
  target_compile_options(orbit_engine_node PRIVATE /EHsc)

  get_filename_component(ORBIT_ENGINE_NODE_HEADERS_ROOT
    "${ORBIT_ENGINE_NODE_INCLUDE_DIR}/.."
    ABSOLUTE
  )
  set(ORBIT_ENGINE_NODE_API_DEF
    "${ORBIT_ENGINE_NODE_HEADERS_ROOT}/def/node_api.def"
  )
  set(ORBIT_ENGINE_NODE_API_IMPORT_LIB
    "${CMAKE_CURRENT_BINARY_DIR}/node_api.lib"
  )

  add_custom_command(
    OUTPUT "${ORBIT_ENGINE_NODE_API_IMPORT_LIB}"
    COMMAND "${CMAKE_AR}"
      "/def:${ORBIT_ENGINE_NODE_API_DEF}"
      "/machine:X64"
      "/out:${ORBIT_ENGINE_NODE_API_IMPORT_LIB}"
    DEPENDS "${ORBIT_ENGINE_NODE_API_DEF}"
    VERBATIM
  )
  add_custom_target(orbit_engine_node_api_import_lib
    DEPENDS "${ORBIT_ENGINE_NODE_API_IMPORT_LIB}"
  )
  add_library(orbit_engine_node_api_import STATIC IMPORTED)
  set_target_properties(orbit_engine_node_api_import PROPERTIES
    IMPORTED_LOCATION "${ORBIT_ENGINE_NODE_API_IMPORT_LIB}"
  )
  add_dependencies(orbit_engine_node orbit_engine_node_api_import_lib)
  target_link_libraries(orbit_engine_node PRIVATE orbit_engine_node_api_import)
endif()

set_target_properties(orbit_engine_node PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "orbit_engine"
  LIBRARY_OUTPUT_DIRECTORY "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/node-archive"
  LIBRARY_OUTPUT_DIRECTORY_RELEASE "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/node-archive"
)
