add_library(orbit_engine_node MODULE
  addon.cpp
)

add_library(orbit_engine_oep_node MODULE
  oep_addon.cpp
)

foreach(ORBIT_ENGINE_NODE_TARGET orbit_engine_node orbit_engine_oep_node)
  target_link_libraries(${ORBIT_ENGINE_NODE_TARGET} PRIVATE orbit_engine_core)

  target_include_directories(${ORBIT_ENGINE_NODE_TARGET}
    PRIVATE
      ${ORBIT_ENGINE_NODE_INCLUDE_DIR}
      ${ORBIT_ENGINE_NODE_ADDON_API_DIR}
  )

  target_compile_definitions(${ORBIT_ENGINE_NODE_TARGET} PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS)

  if(MSVC)
    target_compile_options(${ORBIT_ENGINE_NODE_TARGET} PRIVATE /EHsc)
  endif()
endforeach()

if(MSVC)
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
  foreach(ORBIT_ENGINE_NODE_TARGET orbit_engine_node orbit_engine_oep_node)
    add_dependencies(${ORBIT_ENGINE_NODE_TARGET} orbit_engine_node_api_import_lib)
    target_link_libraries(${ORBIT_ENGINE_NODE_TARGET} PRIVATE orbit_engine_node_api_import)
  endforeach()
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

set_target_properties(orbit_engine_oep_node PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "orbit_engine_oep"
  LIBRARY_OUTPUT_DIRECTORY "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/node-archive"
  LIBRARY_OUTPUT_DIRECTORY_RELEASE "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${ORBIT_ENGINE_NODE_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/node-archive"
)
