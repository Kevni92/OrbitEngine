#include "orbit_engine/numerical.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <utility>

namespace orbit_engine::numerical {
namespace {

constexpr std::size_t kStages = 12;
constexpr std::size_t kExtendedStages = 16;
constexpr double kSafety = 0.9;
constexpr double kMinFactor = 0.2;
constexpr double kMaxFactor = 10.0;
constexpr std::array<double, kExtendedStages> kC{
  0.0,
  0.0526001519587677318785587544488,
  0.0789002279381515978178381316732,
  0.118350341907227396726757197510,
  0.281649658092772603273242802490,
  0.333333333333333333333333333333,
  0.25,
  0.307692307692307692307692307692,
  0.651282051282051282051282051282,
  0.6,
  0.857142857142857142857142857142,
  1.0,
  1.0,
  0.1,
  0.2,
  0.777777777777777777777777777778,
};

// The zero entries are intentionally explicit: deterministic summation order
// is part of the portable numerical contract.
constexpr std::array<std::array<double, kExtendedStages>, kExtendedStages> kA = [] {
  std::array<std::array<double, kExtendedStages>, kExtendedStages> a{};
  a[1][0] = 5.26001519587677318785587544488e-2;
  a[2][0] = 1.97250569845378994544595329183e-2; a[2][1] = 5.91751709536136983633785987549e-2;
  a[3][0] = 2.95875854768068491816892993775e-2; a[3][2] = 8.87627564304205475450678981324e-2;
  a[4][0] = 2.41365134159266685502369798665e-1; a[4][2] = -8.84549479328286085344864962717e-1; a[4][3] = 9.24834003261792003115737966543e-1;
  a[5][0] = 3.7037037037037037037037037037e-2; a[5][3] = 1.70828608729473871279604482173e-1; a[5][4] = 1.25467687566822425016691814123e-1;
  a[6][0] = 3.7109375e-2; a[6][3] = 1.70252211019544039314978060272e-1; a[6][4] = 6.02165389804559606850219397283e-2; a[6][5] = -1.7578125e-2;
  a[7][0] = 3.70920001185047927108779319836e-2; a[7][3] = 1.70383925712239993810273719705e-1; a[7][4] = 1.07262030446373284651809199168e-1; a[7][5] = -1.53194377486244017527936158236e-2; a[7][6] = 8.27378916381402288758473766002e-3;
  a[8][0] = 6.24110958716075717114429577812e-1; a[8][3] = -3.36089262944694129406857109825; a[8][4] = -8.68219346841726006818189891453e-1; a[8][5] = 2.75920996994467083049415600797e1; a[8][6] = 2.01540675504778934086186788979e1; a[8][7] = -4.34898841810699588477366255144e1;
  a[9][0] = 4.77662536438264365890433908527e-1; a[9][3] = -2.48811461997166764192642586468; a[9][4] = -5.90290826836842996371446475743e-1; a[9][5] = 2.12300514481811942347288949897e1; a[9][6] = 1.52792336328824235832586722938e1; a[9][7] = -3.32882109689848629194453265587e1; a[9][8] = -2.03312017085086261358222928593e-2;
  a[10][0] = -9.3714243008598732571704021658e-1; a[10][3] = 5.18637242884406370830023853209; a[10][4] = 1.09143734899672957818505394654; a[10][5] = -8.14978701074692612513997267357; a[10][6] = -1.85200656599969598641566180701e1; a[10][7] = 2.27394870993505042818970056734e1; a[10][8] = 2.49360555267965238987089396762; a[10][9] = -3.0467644718982195003823669022;
  a[11][0] = 2.27331014751653820792359768449; a[11][3] = -1.05344954667372501984066689879e1; a[11][4] = -2.00087205822486249909675718444; a[11][5] = -1.79589318631187989172765950534e1; a[11][6] = 2.79488845294199600508499808837e1; a[11][7] = -2.85899827713502369474065508674; a[11][8] = -8.87285693353062954433549289258; a[11][9] = 1.23605671757943030647266201528e1; a[11][10] = 6.43392746015763530355970484046e-1;
  a[12][0] = 5.42937341165687622380535766363e-2; a[12][5] = 4.45031289275240888144113950566; a[12][6] = 1.89151789931450038304281599044; a[12][7] = -5.8012039600105847814672114227; a[12][8] = 3.1116436695781989440891606237e-1; a[12][9] = -1.52160949662516078556178806805e-1; a[12][10] = 2.01365400804030348374776537501e-1; a[12][11] = 4.47106157277725905176885569043e-2;
  a[13][0] = 5.61675022830479523392909219681e-2; a[13][6] = 2.53500210216624811088794765333e-1; a[13][7] = -2.46239037470802489917441475441e-1; a[13][8] = -1.24191423263816360469010140626e-1; a[13][9] = 1.5329179827876569731206322685e-1; a[13][10] = 8.20105229563468988491666602057e-3; a[13][11] = 7.56789766054569976138603589584e-3; a[13][12] = -8.298e-3;
  a[14][0] = 3.18346481635021405060768473261e-2; a[14][5] = 2.83009096723667755288322961402e-2; a[14][6] = 5.35419883074385676223797384372e-2; a[14][7] = -5.49237485713909884646569340306e-2; a[14][10] = -1.08347328697249322858509316994e-4; a[14][11] = 3.82571090835658412954920192323e-4; a[14][12] = -3.40465008687404560802977114492e-4; a[14][13] = 1.41312443674632500278074618366e-1;
  a[15][0] = -4.28896301583791923408573538692e-1; a[15][5] = -4.69762141536116384314449447206; a[15][6] = 7.68342119606259904184240953878; a[15][7] = 4.06898981839711007970285354331; a[15][8] = 3.56727187455281109270669543021e-1; a[15][12] = -1.39902416515901462129418009734e-3; a[15][13] = 2.9475147891527723389556272149; a[15][14] = -9.15095847217987001081870187138;
  return a;
}();

constexpr std::array<double, kStages> kB{
  5.42937341165687622380535766363e-2, 0.0, 0.0, 0.0, 0.0,
  4.45031289275240888144113950566, 1.89151789931450038304281599044,
  -5.8012039600105847814672114227, 3.1116436695781989440891606237e-1,
  -1.52160949662516078556178806805e-1, 2.01365400804030348374776537501e-1,
  4.47106157277725905176885569043e-2,
};
constexpr std::array<double, kStages + 1> kE3{
  5.42937341165687622380535766363e-2 - 0.244094488188976377952755905512,
  0.0, 0.0, 0.0, 0.0, 4.45031289275240888144113950566,
  1.89151789931450038304281599044, -5.8012039600105847814672114227,
  3.1116436695781989440891606237e-1 - 0.733846688281611857341361741547,
  -1.52160949662516078556178806805e-1, 2.01365400804030348374776537501e-1,
  4.47106157277725905176885569043e-2 - 0.220588235294117647058823529412e-1, 0.0,
};
constexpr std::array<double, kStages + 1> kE5{
  0.1312004499419488073250102996e-1, 0.0, 0.0, 0.0, 0.0,
  -0.1225156446376204440720569753e+1, -0.4957589496572501915214079952,
  0.1664377182454986536961530415e+1, -0.3503288487499736816887290,
  0.3341791187130174790297318841, 0.8192320648511571246570742613e-1,
  -0.2235530786388629525884427845e-1, 0.0,
};

constexpr std::array<std::array<double, kExtendedStages>, 4> kD = {{
  {{-8.4289382761090128651353491142, 0, 0, 0, 0, 0.56671495351937776962531783590, -3.0689499459498916912704704727, 2.3846676565120698287753134976, 2.1170345824450282767155149949, -0.87139158377797299206789907490, 2.2404374302607882749540472165, 0.63157877876946881815570249290, -0.088990336451333310820673977400, 18.148505520854727256656404962, -9.194632392478355400045195936, -4.4360363875948939664310572000}},
  {{10.42750864257913460341310501009, 0, 0, 0, 0, 242.28349177525818288430175319, 165.20045171727028198505394887, -374.54675472269020238830791215, -22.113666853125306036205892, 7.733432668472263838965751, -30.674084731089398182053959, -9.332130526430227872956967217, 15.697238121770843886135, -31.139403219565177677585, -9.352924358844478386573, 35.816841486394083752452}},
  {{19.985053242002433820987653617, 0, 0, 0, 0, -387.03730874935176555105901742, -189.17813819516756882838328328, 527.80815920542364900561016686, -11.573902539959630126118, 6.8812326946963000169669266, -1.0006050966910838403183861, 0.77771377980534432092869265740, -2.778205752353508406594771, -60.196695231264120758252, 84.320405506677161036681, 11.992291136182789328028}},
  {{-25.693933462703749003312586129, 0, 0, 0, 0, -154.18974869023643374053993627, -231.52937917604549567536039109, 357.63911791061412378285349910, 93.405324183624300100390, -37.458323136451633116857531, 104.099649508962300451472, 29.840293426660503123344, -43.533456590011143754432, 96.324553959188282948349, -39.177261675615439165, -149.72683625798562581422}},
}};

bool finite_state(std::span<const double> state) noexcept {
  return std::all_of(state.begin(), state.end(), [](double value) { return std::isfinite(value); });
}

bool round_to_even_nanoseconds(double seconds, std::int64_t& nanoseconds) noexcept {
  if (!std::isfinite(seconds) || seconds < 0.0) return false;
  const double scaled = seconds * static_cast<double>(time::kNanosecondsPerSecond);
  if (!std::isfinite(scaled) || scaled > static_cast<double>(std::numeric_limits<std::int64_t>::max())) return false;
  const double lower = std::floor(scaled);
  const double fraction = scaled - lower;
  double rounded = lower;
  if (fraction > 0.5 || (fraction == 0.5 && std::fmod(lower, 2.0) != 0.0)) rounded += 1.0;
  if (rounded > static_cast<double>(std::numeric_limits<std::int64_t>::max())) return false;
  nanoseconds = static_cast<std::int64_t>(rounded);
  return nanoseconds > 0;
}

bool quantize_step_seconds_impl(double seconds, time::Duration& duration) noexcept {
  std::int64_t nanos = 0;
  if (!round_to_even_nanoseconds(seconds, nanos)) return false;
  const auto seconds_part = nanos / static_cast<std::int64_t>(time::kNanosecondsPerSecond);
  const auto nanos_part = nanos % static_cast<std::int64_t>(time::kNanosecondsPerSecond);
  duration = time::Duration{seconds_part, static_cast<std::uint32_t>(nanos_part)};
  return true;
}

double norm_from_scaled(std::span<const double> values, std::span<const double> scales) noexcept {
  double sum = 0.0;
  for (std::size_t i = 0; i < values.size(); ++i) {
    const double value = values[i] / scales[i];
    sum += value * value;
  }
  return std::sqrt(sum / static_cast<double>(values.size()));
}

}  // namespace

bool quantize_step_seconds(double seconds, time::Duration& duration) noexcept {
  return quantize_step_seconds_impl(seconds, duration);
}

bool Configuration::validate(Failure& failure) const noexcept {
  const auto invalid = [&failure](const char* message) {
    failure = Failure{FailureCode::invalid_configuration, message};
    return false;
  };
  if (!std::isfinite(relative_tolerance) || relative_tolerance <= 0.0) return invalid("relative tolerance must be finite and positive");
  if (!std::isfinite(position_absolute_tolerance_meters) || position_absolute_tolerance_meters <= 0.0) return invalid("position tolerance must be finite and positive");
  if (!std::isfinite(velocity_absolute_tolerance_meters_per_second) || velocity_absolute_tolerance_meters_per_second <= 0.0) return invalid("velocity tolerance must be finite and positive");
  if (!std::isfinite(mass_absolute_tolerance_kilograms) || mass_absolute_tolerance_kilograms <= 0.0) return invalid("mass tolerance must be finite and positive");
  if (!time::is_normalized(min_step) || !time::is_normalized(max_step)
      || time::compare(min_step, time::Duration{0, 1}) < 0
      || time::compare(max_step, min_step) < 0) return invalid("step bounds are invalid");
  if (checkpoint_stride_accepted_steps == 0 || max_checkpoint_count == 0 || max_dense_step_count == 0 || max_accepted_steps_per_extension == 0 || max_rejected_steps_per_extension == 0) return invalid("cache and work budgets must be positive");
  for (const auto component : component_kinds) {
    if (component != ComponentKind::position
        && component != ComponentKind::velocity
        && component != ComponentKind::mass) {
      return invalid("component tolerance layout contains an unknown component kind");
    }
  }
  return true;
}

DOP853Tape::DOP853Tape(Anchor anchor, Configuration configuration, DerivativeFunction derivative, std::vector<HardBoundary> hard_boundaries)
  : anchor_(std::move(anchor)), configuration_(configuration), derivative_(std::move(derivative)), hard_boundaries_(std::move(hard_boundaries)) {
  if (!configuration_.validate(construction_failure_)) return;
  if (!time::is_normalized(anchor_.epoch) || anchor_.state.empty() || !finite_state(anchor_.state) || !derivative_) {
    construction_failure_ = Failure{FailureCode::invalid_configuration, "DOP853 anchor or derivative is invalid"};
    return;
  }
  std::sort(hard_boundaries_.begin(), hard_boundaries_.end(), [](const HardBoundary& left, const HardBoundary& right) { return time::compare(left.instant, right.instant) < 0; });
  for (const auto& boundary : hard_boundaries_) {
    if (!time::is_normalized(boundary.instant) || time::compare(boundary.instant, anchor_.epoch) <= 0) {
      construction_failure_ = Failure{FailureCode::invalid_configuration, "hard boundaries must be normalized and after the anchor"};
      return;
    }
  }
  current_epoch_ = anchor_.epoch;
  current_state_ = anchor_.state;
  valid_ = true;
}

bool DOP853Tape::valid() const noexcept { return valid_; }
const Failure& DOP853Tape::construction_failure() const noexcept { return construction_failure_; }

void DOP853Tape::fail(Failure& failure, FailureCode code, const char* message) const noexcept { failure = Failure{code, message}; }

double DOP853Tape::component_absolute_tolerance(std::size_t index) const noexcept {
  if (index < configuration_.component_kinds.size()) {
    switch (configuration_.component_kinds[index]) {
      case ComponentKind::position: return configuration_.position_absolute_tolerance_meters;
      case ComponentKind::velocity: return configuration_.velocity_absolute_tolerance_meters_per_second;
      case ComponentKind::mass: return configuration_.mass_absolute_tolerance_kilograms;
    }
  }
  if (index < 3) return configuration_.position_absolute_tolerance_meters;
  if (index < 6) return configuration_.velocity_absolute_tolerance_meters_per_second;
  if (configuration_.has_mass_component && index == 6) return configuration_.mass_absolute_tolerance_kilograms;
  return configuration_.position_absolute_tolerance_meters;
}

double DOP853Tape::next_boundary_seconds(time::SimulationInstant start) const noexcept {
  for (const auto& boundary : hard_boundaries_) {
    if (time::compare(boundary.instant, start) > 0) {
      const auto duration = time::subtract(boundary.instant, start);
      return duration.has_value() ? time::to_seconds(*duration) : 0.0;
    }
  }
  return std::numeric_limits<double>::infinity();
}

bool DOP853Tape::initialize(Failure& failure) {
  if (initialized_) return true;
  std::vector<double> derivative(current_state_.size());
  const NumericalSampleTime sample{current_epoch_, 0.0};
  if (!derivative_(sample, current_state_, derivative, failure)) {
    if (failure.code == FailureCode::none) failure = Failure{FailureCode::derivative_failure, "initial derivative evaluation failed"};
    return false;
  }
  if (!finite_state(derivative)) { fail(failure, FailureCode::non_finite_derivative, "initial derivative is non-finite"); return false; }
  std::vector<double> scales(current_state_.size());
  for (std::size_t i = 0; i < scales.size(); ++i) scales[i] = component_absolute_tolerance(i) + configuration_.relative_tolerance * std::abs(current_state_[i]);
  const double d0 = norm_from_scaled(current_state_, scales);
  const double d1 = norm_from_scaled(derivative, scales);
  double h0 = (d0 < 1e-5 || d1 < 1e-5) ? 1e-6 : 0.01 * d0 / d1;
  h0 = std::min(h0, time::to_seconds(configuration_.max_step));
  const double boundary = next_boundary_seconds(current_epoch_);
  h0 = std::min(h0, boundary);
  if (!std::isfinite(h0) || h0 <= 0.0) h0 = std::min(1e-6, time::to_seconds(configuration_.max_step));
  next_step_seconds_ = std::max(time::to_seconds(configuration_.min_step), h0);
  if (std::isfinite(boundary)) next_step_seconds_ = std::min(next_step_seconds_, boundary);
  initialized_ = true;
  checkpoints_.push_back(Checkpoint{CheckpointInfo{anchor_.epoch, anchor_.state.size(), next_step_seconds_, 0, configuration_.configuration_identity, anchor_.segment_identity}, anchor_.state});
  return true;
}

bool DOP853Tape::attempt_step(double proposed_seconds, time::SimulationInstant exact_start, std::vector<double>& state, time::SimulationInstant& exact_end, double& next_proposed_seconds, DenseRecord& dense, bool& accepted, Failure& failure) {
  accepted = false;
  const double boundary_seconds = next_boundary_seconds(exact_start);
  const double min_step_seconds = time::to_seconds(configuration_.min_step);
  const double max_step_seconds = time::to_seconds(configuration_.max_step);
  double bounded = std::min({proposed_seconds, max_step_seconds, boundary_seconds});
  if (bounded < min_step_seconds && !(std::isfinite(boundary_seconds) && bounded == boundary_seconds)) bounded = min_step_seconds;
  time::Duration duration{};
  if (!quantize_step_seconds(bounded, duration)) { fail(failure, FailureCode::step_underflow, "proposed step cannot be represented by one nanosecond"); return false; }
  const auto endpoint = time::add(exact_start, duration);
  if (!endpoint.has_value()) { fail(failure, FailureCode::step_underflow, "step endpoint overflowed exact time"); return false; }
  exact_end = *endpoint;
  const double h = time::to_seconds(duration);
  std::vector<std::vector<double>> k(kExtendedStages, std::vector<double>(state.size()));
  k[0].assign(state.size(), 0.0);
  if (!derivative_(NumericalSampleTime{exact_start, 0.0}, state, k[0], failure)) { if (failure.code == FailureCode::none) failure = Failure{FailureCode::derivative_failure, "DOP853 initial stage failed"}; return false; }
  if (!finite_state(k[0])) { fail(failure, FailureCode::non_finite_derivative, "DOP853 derivative is non-finite"); return false; }
  for (std::size_t stage = 1; stage < kStages; ++stage) {
    std::vector<double> candidate = state;
    for (std::size_t component = 0; component < state.size(); ++component) {
      double sum = 0.0;
      for (std::size_t previous = 0; previous < stage; ++previous) sum += k[previous][component] * kA[stage][previous];
      candidate[component] += h * sum;
    }
    if (!finite_state(candidate)) { fail(failure, FailureCode::non_finite_candidate, "DOP853 stage candidate is non-finite"); return false; }
    if (!derivative_(NumericalSampleTime{exact_start, kC[stage] * h}, candidate, k[stage], failure)) { if (failure.code == FailureCode::none) failure = Failure{FailureCode::derivative_failure, "DOP853 stage derivative failed"}; return false; }
    if (!finite_state(k[stage])) { fail(failure, FailureCode::non_finite_derivative, "DOP853 stage derivative is non-finite"); return false; }
  }
  std::vector<double> candidate = state;
  for (std::size_t component = 0; component < state.size(); ++component) {
    double sum = 0.0;
    for (std::size_t stage = 0; stage < kStages; ++stage) sum += k[stage][component] * kB[stage];
    candidate[component] += h * sum;
  }
  if (!finite_state(candidate)) { fail(failure, FailureCode::non_finite_candidate, "DOP853 endpoint is non-finite"); return false; }
  if (!derivative_(NumericalSampleTime{exact_start, h}, candidate, k[12], failure)) { if (failure.code == FailureCode::none) failure = Failure{FailureCode::derivative_failure, "DOP853 endpoint derivative failed"}; return false; }
  if (!finite_state(k[12])) { fail(failure, FailureCode::non_finite_derivative, "DOP853 endpoint derivative is non-finite"); return false; }
  std::vector<double> scales(state.size());
  std::vector<double> error5(state.size());
  std::vector<double> error3(state.size());
  for (std::size_t component = 0; component < state.size(); ++component) {
    double e5 = 0.0;
    double e3 = 0.0;
    for (std::size_t stage = 0; stage <= kStages; ++stage) { e5 += k[stage][component] * kE5[stage]; e3 += k[stage][component] * kE3[stage]; }
    error5[component] = e5;
    error3[component] = e3;
    scales[component] = component_absolute_tolerance(component) + configuration_.relative_tolerance * std::max(std::abs(state[component]), std::abs(candidate[component]));
    if (!std::isfinite(scales[component]) || scales[component] <= 0.0) { fail(failure, FailureCode::non_finite_candidate, "DOP853 error scale is invalid"); return false; }
  }
  double error5Norm2 = 0.0;
  double error3Norm2 = 0.0;
  for (std::size_t component = 0; component < state.size(); ++component) { const double a = error5[component] / scales[component]; const double b = error3[component] / scales[component]; error5Norm2 += a * a; error3Norm2 += b * b; }
  const double denominator = error5Norm2 + 0.01 * error3Norm2;
  const double error_norm = denominator == 0.0 ? 0.0 : std::abs(h) * error5Norm2 / std::sqrt(denominator * static_cast<double>(state.size()));
  if (!std::isfinite(error_norm)) { fail(failure, FailureCode::non_finite_candidate, "DOP853 error norm is non-finite"); return false; }
  const double factor = error_norm == 0.0 ? kMaxFactor : std::min(kMaxFactor, kSafety * std::pow(error_norm, -1.0 / 8.0));
  next_proposed_seconds = std::max(min_step_seconds, std::min(max_step_seconds, h * factor));
  if (error_norm > 1.0) return true;
  for (std::size_t extra = kStages + 1; extra < kExtendedStages; ++extra) {
    std::vector<double> extra_state = state;
    for (std::size_t component = 0; component < state.size(); ++component) { double sum = 0.0; for (std::size_t previous = 0; previous < extra; ++previous) sum += k[previous][component] * kA[extra][previous]; extra_state[component] += h * sum; }
    if (!finite_state(extra_state)) { fail(failure, FailureCode::non_finite_candidate, "DOP853 dense stage is non-finite"); return false; }
    if (!derivative_(NumericalSampleTime{exact_start, kC[extra] * h}, extra_state, k[extra], failure)) { if (failure.code == FailureCode::none) failure = Failure{FailureCode::derivative_failure, "DOP853 dense derivative failed"}; return false; }
    if (!finite_state(k[extra])) { fail(failure, FailureCode::non_finite_derivative, "DOP853 dense derivative is non-finite"); return false; }
  }
  dense.start = exact_start; dense.end = exact_end; dense.step_seconds = h; dense.start_state = state; dense.configuration_identity = configuration_.configuration_identity; dense.segment_identity = anchor_.segment_identity;
  dense.coefficients.assign(7 * state.size(), 0.0);
  for (std::size_t component = 0; component < state.size(); ++component) {
    const double delta = candidate[component] - state[component];
    dense.coefficients[component] = delta;
    dense.coefficients[state.size() + component] = h * k[0][component] - delta;
    dense.coefficients[2 * state.size() + component] = 2.0 * delta - h * (k[12][component] + k[0][component]);
    for (std::size_t row = 0; row < 4; ++row) { double value = 0.0; for (std::size_t stage = 0; stage < kExtendedStages; ++stage) value += kD[row][stage] * k[stage][component]; dense.coefficients[(3 + row) * state.size() + component] = h * value; }
  }
  state = std::move(candidate);
  accepted = true;
  return true;
}

bool DOP853Tape::extend_until(time::SimulationInstant target, Failure& failure) {
  if (!initialize(failure)) return false;
  std::size_t accepted_this_extension = 0;
  std::size_t rejected_this_extension = 0;
  while (time::compare(current_epoch_, target) < 0) {
    DenseRecord dense;
    std::vector<double> candidate = current_state_;
    time::SimulationInstant endpoint{};
    double next_proposed = next_step_seconds_;
    bool accepted = false;
    if (!attempt_step(next_step_seconds_, current_epoch_, candidate, endpoint, next_proposed, dense, accepted, failure)) return false;
    if (!accepted) {
      ++rejected_step_count_; ++rejected_this_extension;
      if (rejected_this_extension > configuration_.max_rejected_steps_per_extension) { fail(failure, FailureCode::rejected_step_budget, "DOP853 rejected-step budget exhausted"); return false; }
      if (next_proposed < time::to_seconds(configuration_.min_step) && next_boundary_seconds(current_epoch_) > time::to_seconds(configuration_.min_step)) { fail(failure, FailureCode::step_underflow, "DOP853 requires a step below configured minimum"); return false; }
      next_step_seconds_ = next_proposed;
      continue;
    }
    ++accepted_step_count_; ++accepted_this_extension;
    if (accepted_this_extension > configuration_.max_accepted_steps_per_extension) { fail(failure, FailureCode::accepted_step_budget, "DOP853 accepted-step budget exhausted"); return false; }
    current_epoch_ = endpoint;
    current_state_ = std::move(candidate);
    next_step_seconds_ = next_proposed;
    retain_dense(std::move(dense));
    if (accepted_step_count_ % configuration_.checkpoint_stride_accepted_steps == 0) retain_checkpoint();
  }
  return true;
}

bool DOP853Tape::evaluate_dense(const DenseRecord& record, time::SimulationInstant target, std::vector<double>& state, Failure& failure) const {
  const auto duration = time::subtract(target, record.start);
  if (!duration.has_value() || time::compare(target, record.end) > 0) { fail(failure, FailureCode::invalid_state, "target is outside dense-output record"); return false; }
  const double x = time::to_seconds(*duration) / record.step_seconds;
  if (!std::isfinite(x) || x < 0.0 || x > 1.0) { fail(failure, FailureCode::invalid_state, "dense-output interpolation fraction is invalid"); return false; }
  state.assign(record.start_state.size(), 0.0);
  for (std::size_t component = 0; component < state.size(); ++component) {
    double value = 0.0;
    for (std::size_t index = 0; index < 7; ++index) { value += record.coefficients[(6 - index) * state.size() + component]; if (index % 2 == 0) value *= x; else value *= 1.0 - x; }
    state[component] = record.start_state[component] + value;
  }
  if (!finite_state(state)) { fail(failure, FailureCode::non_finite_candidate, "dense-output state is non-finite"); return false; }
  return true;
}

void DOP853Tape::retain_dense(DenseRecord record) noexcept {
  dense_records_.push_back(std::move(record));
  while (dense_records_.size() > configuration_.max_dense_step_count) dense_records_.erase(dense_records_.begin());
}

void DOP853Tape::retain_checkpoint() noexcept {
  checkpoints_.push_back(Checkpoint{CheckpointInfo{current_epoch_, current_state_.size(), next_step_seconds_, accepted_step_count_, configuration_.configuration_identity, anchor_.segment_identity}, current_state_});
  while (checkpoints_.size() > configuration_.max_checkpoint_count + 1) checkpoints_.erase(checkpoints_.begin() + 1);
}

bool DOP853Tape::replay_from_anchor(time::SimulationInstant target, std::vector<double>& state, Failure& failure) const {
  DOP853Tape replay(anchor_, configuration_, derivative_, hard_boundaries_);
  if (!replay.valid()) { failure = replay.construction_failure(); return false; }
  return replay.evaluate(target, state, failure);
}

bool DOP853Tape::evaluate(time::SimulationInstant target, std::vector<double>& state, Failure& failure) {
  if (!valid_) { failure = construction_failure_; return false; }
  if (!time::is_normalized(target)) { fail(failure, FailureCode::invalid_state, "target instant is not normalized"); return false; }
  if (time::compare(target, anchor_.epoch) < 0) { fail(failure, FailureCode::unsupported_temporal_direction, "DOP853 tape integrates forward only from its anchor"); return false; }
  if (time::compare(target, current_epoch_) > 0 && !extend_until(target, failure)) return false;
  if (time::compare(target, current_epoch_) == 0) { state = current_state_; return true; }
  for (auto it = dense_records_.rbegin(); it != dense_records_.rend(); ++it) {
    if (time::compare(target, it->start) >= 0 && time::compare(target, it->end) <= 0) return evaluate_dense(*it, target, state, failure);
  }
  return replay_from_anchor(target, state, failure);
}

bool DOP853Tape::invalidate_from(time::SimulationInstant instant, std::uint64_t new_segment_identity, Failure& failure) {
  if (!valid_ || !time::is_normalized(instant) || time::compare(instant, anchor_.epoch) < 0) { fail(failure, FailureCode::invalid_state, "invalid numerical cache invalidation instant"); return false; }
  if (time::compare(instant, current_epoch_) < 0) { fail(failure, FailureCode::invalid_state, "cannot invalidate committed history before the current tape endpoint"); return false; }
  anchor_.segment_identity = new_segment_identity;
  dense_records_.clear();
  checkpoints_.clear();
  initialized_ = false;
  current_epoch_ = instant;
  current_state_ = anchor_.state;
  accepted_step_count_ = 0;
  rejected_step_count_ = 0;
  return true;
}

TapeDiagnostics DOP853Tape::diagnostics() const noexcept { return TapeDiagnostics{current_epoch_, accepted_step_count_, rejected_step_count_, checkpoints_.size(), dense_records_.size()}; }

std::vector<CheckpointInfo> DOP853Tape::checkpoints() const {
  std::vector<CheckpointInfo> result;
  result.reserve(checkpoints_.size());
  for (const auto& checkpoint : checkpoints_) result.push_back(checkpoint.info);
  return result;
}

}  // namespace orbit_engine::numerical
