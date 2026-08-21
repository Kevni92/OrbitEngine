#include "orbit_engine/frame.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/propagation.hpp"
#include "orbit_engine/core.hpp"
#include "orbit_engine/time.hpp"

#include <array>
#include <cstdint>
#include <iostream>
#include <limits>

#define CHECK(condition) \
  do { \
    if (!(condition)) { \
      std::cerr << "check failed: " #condition "\n"; \
      return 1; \
    } \
  } while (false)

int main() {
  const auto result = orbit_engine::health();

  if (result.core_version != orbit_engine::kCoreVersion || result.health_code != 42) {
    std::cerr << "unexpected core health result\n";
    return 1;
  }

  if (orbit_engine::kBindingProtocolVersion != 5) {
    std::cerr << "unexpected binding protocol version\n";
    return 1;
  }

  using orbit_engine::time::Duration;
  using orbit_engine::time::SimulationInstant;
  using orbit_engine::time::TimeWire;
  using orbit_engine::time::kNanosecondsPerSecond;

  const auto negative = orbit_engine::time::normalize_duration(0, -500'000'000);
  CHECK(negative.has_value());
  CHECK(negative->seconds == -1);
  CHECK(negative->nanoseconds == 500'000'000);

  const auto carried = orbit_engine::time::normalize_instant(0, 1'000'000'000);
  CHECK(carried.has_value());
  CHECK(carried->seconds == 1);
  CHECK(carried->nanoseconds == 0);

  const auto borrowed = orbit_engine::time::normalize_instant(1, -1);
  CHECK(borrowed.has_value());
  CHECK(borrowed->seconds == 0);
  CHECK(borrowed->nanoseconds == 999'999'999);

  const SimulationInstant before{-1, 999'999'999};
  const SimulationInstant at{0, 0};
  const SimulationInstant after{0, 1};
  CHECK(orbit_engine::time::compare(before, at) < 0);
  CHECK(orbit_engine::time::compare(at, at) == 0);
  CHECK(orbit_engine::time::compare(after, at) > 0);

  const auto difference = orbit_engine::time::subtract(after, before);
  CHECK(difference.has_value());
  CHECK(difference->seconds == 0);
  CHECK(difference->nanoseconds == 2);

  const auto sum = orbit_engine::time::add(at, Duration{-1, 500'000'000});
  CHECK(sum.has_value());
  CHECK(sum->seconds == -1);
  CHECK(sum->nanoseconds == 500'000'000);

  const auto durationSum = orbit_engine::time::add(Duration{1, 750'000'000}, Duration{0, 250'000'000});
  CHECK(durationSum.has_value());
  CHECK(durationSum->seconds == 2);
  CHECK(durationSum->nanoseconds == 0);

  const auto durationDifference = orbit_engine::time::subtract(Duration{1, 0}, Duration{0, 1});
  CHECK(durationDifference.has_value());
  CHECK(durationDifference->seconds == 0);
  CHECK(durationDifference->nanoseconds == 999'999'999);

  const auto negated = orbit_engine::time::negate(Duration{0, 1});
  CHECK(negated.has_value());
  CHECK(negated->seconds == -1);
  CHECK(negated->nanoseconds == 999'999'999);
  CHECK(orbit_engine::time::to_seconds(Duration{1, 500'000'000}) == 1.5);

  const SimulationInstant maximum{std::numeric_limits<std::int64_t>::max(), kNanosecondsPerSecond - 1};
  const SimulationInstant minimum{std::numeric_limits<std::int64_t>::min(), 0};
  const Duration oneNanosecond{0, 1};
  CHECK(!orbit_engine::time::add(maximum, oneNanosecond).has_value());
  CHECK(!orbit_engine::time::subtract(minimum, oneNanosecond).has_value());
  CHECK(!orbit_engine::time::add(
    Duration{std::numeric_limits<std::int64_t>::max(), kNanosecondsPerSecond - 1},
    oneNanosecond
  ).has_value());
  CHECK(!orbit_engine::time::subtract(
    Duration{std::numeric_limits<std::int64_t>::min(), 0},
    oneNanosecond
  ).has_value());
  CHECK(!orbit_engine::time::negate(Duration{std::numeric_limits<std::int64_t>::min(), 0}).has_value());

  const SimulationInstant positiveWide{0x1'0000'0000LL + 123, 999'999'999};
  const TimeWire positiveWire = orbit_engine::time::to_wire(positiveWide);
  CHECK(positiveWire.seconds_high == 1);
  CHECK(positiveWire.seconds_low == 123);
  CHECK(positiveWire.nanoseconds == 999'999'999);
  const auto positiveDecoded = orbit_engine::time::from_wire(positiveWire);
  CHECK(positiveDecoded.has_value());
  CHECK(positiveDecoded->seconds == positiveWide.seconds);
  CHECK(positiveDecoded->nanoseconds == positiveWide.nanoseconds);

  const Duration durationWide{positiveWide.seconds, positiveWide.nanoseconds};
  const TimeWire durationWire = orbit_engine::time::to_wire(durationWide);
  const auto durationDecoded = orbit_engine::time::from_wire_duration(durationWire);
  CHECK(durationDecoded.has_value());
  CHECK(durationDecoded->seconds == durationWide.seconds);
  CHECK(durationDecoded->nanoseconds == durationWide.nanoseconds);

  const SimulationInstant negativeWide{-(0x1'0000'0000LL + 123), 1};
  const TimeWire negativeWire = orbit_engine::time::to_wire(negativeWide);
  CHECK(negativeWire.seconds_high == -2);
  CHECK(negativeWire.seconds_low == 4'294'967'173U);
  TimeWire roundTrippedWire{};
  CHECK(orbit_engine::time::round_trip_wire(negativeWire, roundTrippedWire));
  CHECK(roundTrippedWire.seconds_high == negativeWire.seconds_high);
  CHECK(roundTrippedWire.seconds_low == negativeWire.seconds_low);
  CHECK(roundTrippedWire.nanoseconds == negativeWire.nanoseconds);
  CHECK(!orbit_engine::time::round_trip_wire(TimeWire{0, 0, kNanosecondsPerSecond}, roundTrippedWire));

  constexpr double binary64Sentinel = 3.141592653589793;
  CHECK(orbit_engine::time::round_trip_double(binary64Sentinel) == binary64Sentinel);

  using orbit_engine::object::ObjectId;
  using orbit_engine::object::ObjectIdWire;
  using orbit_engine::object::ObjectType;
  using orbit_engine::object::ObjectWire;
  using orbit_engine::object::OptionalPhysicalScalar;
  using orbit_engine::object::PhysicalProperties;

  const std::array<ObjectId, 5> objectIds{
    1,
    0xFFFF'FFFFULL,
    0x1'0000'0000ULL,
    9'007'199'254'740'993ULL,
    std::numeric_limits<ObjectId>::max(),
  };
  for (const auto id : objectIds) {
    const ObjectIdWire wire = orbit_engine::object::object_id_to_wire(id);
    CHECK(orbit_engine::object::is_valid(id));
    CHECK(orbit_engine::object::object_id_from_wire(wire) == id);
  }
  CHECK(!orbit_engine::object::is_valid(0));
  CHECK(orbit_engine::object::object_id_from_wire(ObjectIdWire{0, 0}) == 0);

  for (std::uint16_t code = 1; code <= 11; ++code) {
    CHECK(orbit_engine::object::is_valid_object_type_code(code));
    const auto type = orbit_engine::object::object_type_from_code(code);
    CHECK(type.has_value());
    CHECK(orbit_engine::object::is_valid(*type));
    CHECK(orbit_engine::object::object_type_code(*type) == code);
  }
  CHECK(!orbit_engine::object::is_valid_object_type_code(0));
  CHECK(!orbit_engine::object::is_valid_object_type_code(12));
  CHECK(!orbit_engine::object::object_type_from_code(0).has_value());
  CHECK(!orbit_engine::object::object_type_from_code(12).has_value());

  const PhysicalProperties absent{
    OptionalPhysicalScalar{false, 0.0},
    OptionalPhysicalScalar{false, 0.0},
    OptionalPhysicalScalar{false, 0.0},
    OptionalPhysicalScalar{false, 0.0},
  };
  CHECK(orbit_engine::object::is_valid(absent));
  const PhysicalProperties explicitZero{
    OptionalPhysicalScalar{true, 0.0},
    OptionalPhysicalScalar{true, 0.0},
    OptionalPhysicalScalar{true, 0.0},
    OptionalPhysicalScalar{true, 0.0},
  };
  CHECK(orbit_engine::object::is_valid(explicitZero));
  CHECK(!orbit_engine::object::is_valid(PhysicalProperties{
    OptionalPhysicalScalar{true, -1.0}, absent.mu, absent.physical_radius, absent.collision_bounding_radius,
  }));
  CHECK(!orbit_engine::object::is_valid(PhysicalProperties{
    OptionalPhysicalScalar{true, std::numeric_limits<double>::infinity()},
    absent.mu,
    absent.physical_radius,
    absent.collision_bounding_radius,
  }));
  CHECK(!orbit_engine::object::is_valid(PhysicalProperties{
    OptionalPhysicalScalar{false, std::numeric_limits<double>::quiet_NaN()},
    absent.mu,
    absent.physical_radius,
    absent.collision_bounding_radius,
  }));

  const PhysicalProperties properties{
    OptionalPhysicalScalar{true, binary64Sentinel},
    OptionalPhysicalScalar{false, 0.0},
    OptionalPhysicalScalar{true, 6'371'000.0},
    OptionalPhysicalScalar{true, 10.0},
  };
  const ObjectId maxId = std::numeric_limits<ObjectId>::max();
  const ObjectIdWire maxIdWire = orbit_engine::object::object_id_to_wire(maxId);
  const ObjectWire objectWire{
    maxIdWire.high,
    maxIdWire.low,
    orbit_engine::object::object_type_code(ObjectType::debris),
    properties,
  };
  CHECK(orbit_engine::object::is_valid(objectWire));
  ObjectWire objectRoundTrip{};
  CHECK(orbit_engine::object::round_trip(objectWire, objectRoundTrip));
  CHECK(objectRoundTrip.object_id_high == objectWire.object_id_high);
  CHECK(objectRoundTrip.object_id_low == objectWire.object_id_low);
  CHECK(objectRoundTrip.object_type_code == objectWire.object_type_code);
  CHECK(objectRoundTrip.properties.mass.present);
  CHECK(objectRoundTrip.properties.mass.value == binary64Sentinel);
  CHECK(!objectRoundTrip.properties.mu.present);
  CHECK(objectRoundTrip.properties.physical_radius.value == 6'371'000.0);
  CHECK(objectRoundTrip.properties.collision_bounding_radius.value == 10.0);
  CHECK(!orbit_engine::object::round_trip(
    ObjectWire{0, 0, objectWire.object_type_code, properties},
    objectRoundTrip
  ));
  CHECK(!orbit_engine::object::round_trip(
    ObjectWire{maxIdWire.high, maxIdWire.low, 0, properties},
    objectRoundTrip
  ));

  using orbit_engine::frame::CartesianState;
  using orbit_engine::frame::FrameWire;
  using orbit_engine::frame::Quaternion;
  using orbit_engine::frame::ReferenceFrameId;
  using orbit_engine::frame::RigidStateTransform;
  using orbit_engine::frame::Vec3;

  const std::array<ReferenceFrameId, 5> frameIds{
    1,
    0xFFFF'FFFFULL,
    0x1'0000'0000ULL,
    9'007'199'254'740'993ULL,
    std::numeric_limits<ReferenceFrameId>::max(),
  };
  for (const auto id : frameIds) {
    const auto wire = orbit_engine::frame::reference_frame_id_to_wire(id);
    CHECK(orbit_engine::frame::is_valid(id));
    CHECK(orbit_engine::frame::reference_frame_id_from_wire(wire) == id);
  }
  CHECK(!orbit_engine::frame::is_valid(0));
  CHECK(orbit_engine::frame::reference_frame_id_from_wire({0, 0}) == 0);

  const SimulationInstant frameEpoch{12, 345};
  const RigidStateTransform rotating{
    Vec3{10.0, 20.0, 30.0},
    Vec3{2.0, 3.0, 4.0},
    Quaternion{1.0, 0.0, 0.0, 0.0},
    Vec3{0.0, 0.0, 1.0},
    frameEpoch,
  };
  const CartesianState state{
    Vec3{1.0, 0.0, 0.0},
    Vec3{0.0, 5.0, 0.0},
    frameEpoch,
  };
  CHECK(orbit_engine::frame::is_valid(rotating));
  const auto transformed = orbit_engine::frame::transform(rotating, state);
  CHECK(transformed.has_value());
  CHECK(transformed->position.x == 11.0);
  CHECK(transformed->position.y == 20.0);
  CHECK(transformed->position.z == 30.0);
  CHECK(transformed->velocity.x == 2.0);
  CHECK(transformed->velocity.y == 9.0);
  CHECK(transformed->velocity.z == 4.0);
  CHECK(transformed->epoch.seconds == frameEpoch.seconds);
  CHECK(transformed->epoch.nanoseconds == frameEpoch.nanoseconds);
  CHECK(!orbit_engine::frame::transform(rotating, CartesianState{state.position, state.velocity, {13, 0}}).has_value());

  const auto inverse = orbit_engine::frame::inverse(rotating);
  CHECK(inverse.has_value());
  const auto identity = orbit_engine::frame::compose(rotating, *inverse);
  CHECK(identity.has_value());
  CHECK(std::abs(identity->translation.x) < 1e-12);
  CHECK(std::abs(identity->translation.y) < 1e-12);
  CHECK(std::abs(identity->translation.z) < 1e-12);
  CHECK(std::abs(identity->origin_velocity.x) < 1e-12);
  CHECK(std::abs(identity->origin_velocity.y) < 1e-12);
  CHECK(std::abs(identity->origin_velocity.z) < 1e-12);
  CHECK(std::abs(identity->rotation.w - 1.0) < 1e-12);
  CHECK(std::abs(identity->angular_velocity.x) < 1e-12);
  CHECK(std::abs(identity->angular_velocity.y) < 1e-12);
  CHECK(std::abs(identity->angular_velocity.z) < 1e-12);

  const auto frameIdWire = orbit_engine::frame::reference_frame_id_to_wire(
    std::numeric_limits<ReferenceFrameId>::max());
  const FrameWire frameWire{
    frameIdWire.high,
    frameIdWire.low,
    orbit_engine::time::to_wire(frameEpoch),
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
  };
  CHECK(orbit_engine::frame::is_valid(frameWire));
  FrameWire frameRoundTrip{};
  CHECK(orbit_engine::frame::round_trip(frameWire, frameRoundTrip));
  CHECK(frameRoundTrip.reference_frame_id_high == frameWire.reference_frame_id_high);
  CHECK(frameRoundTrip.reference_frame_id_low == frameWire.reference_frame_id_low);
  CHECK(frameRoundTrip.rotation_w == 1.0);
  CHECK(!orbit_engine::frame::round_trip(
    FrameWire{0, 0, frameWire.epoch, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0},
    frameRoundTrip
  ));

  using orbit_engine::propagation::PropagationWire;
  const PropagationWire propagationWire{
    maxIdWire.high,
    maxIdWire.low,
    2,
    2,
    0,
    frameIdWire.high,
    frameIdWire.low,
    maxIdWire.high,
    maxIdWire.low,
    0,
    7,
    orbit_engine::time::to_wire(SimulationInstant{-5, 1}),
    true,
    orbit_engine::time::to_wire(SimulationInstant{5, 2}),
    orbit_engine::time::to_wire(SimulationInstant{0, 3}),
    1,
    0,
    1,
    binary64Sentinel,
    -2.0,
    3.0,
    -4.0,
    5.0,
    6.0,
    7.0,
    8.0,
    0.001,
    9.0,
  };
  CHECK(orbit_engine::propagation::is_valid(propagationWire));
  PropagationWire propagationRoundTrip{};
  CHECK(orbit_engine::propagation::round_trip(propagationWire, propagationRoundTrip));
  CHECK(propagationRoundTrip.object_id_high == propagationWire.object_id_high);
  CHECK(propagationRoundTrip.position_x == binary64Sentinel);
  CHECK(!orbit_engine::propagation::round_trip(
    PropagationWire{
      propagationWire.object_id_high,
      propagationWire.object_id_low,
      0,
      propagationWire.direction_code,
      propagationWire.bounded_direction_code,
      propagationWire.propagation_frame_high,
      propagationWire.propagation_frame_low,
      propagationWire.configuration_revision_high,
      propagationWire.configuration_revision_low,
      propagationWire.motion_revision_high,
      propagationWire.motion_revision_low,
      propagationWire.segment_start,
      propagationWire.segment_end_present,
      propagationWire.segment_end,
      propagationWire.target,
      propagationWire.outcome_code,
      propagationWire.result_frame_high,
      propagationWire.result_frame_low,
      propagationWire.position_x,
      propagationWire.position_y,
      propagationWire.position_z,
      propagationWire.velocity_x,
      propagationWire.velocity_y,
      propagationWire.velocity_z,
      propagationWire.position_absolute_meters,
      propagationWire.position_relative,
      propagationWire.velocity_absolute_meters_per_second,
      propagationWire.velocity_relative,
    },
    propagationRoundTrip
  ));

  return 0;
}
