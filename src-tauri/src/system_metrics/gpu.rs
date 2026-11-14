//! Read-only NVML sampling. No driver service, executable or management API is started.

pub struct GpuSampler {
    #[cfg(any(windows, target_os = "linux"))]
    nvml: Option<nvml::Nvml>,
}

impl GpuSampler {
    pub fn new() -> Self {
        Self {
            #[cfg(any(windows, target_os = "linux"))]
            nvml: nvml::Nvml::new(),
        }
    }

    /// Return utilization and temperature from the same busiest readable NVIDIA GPU.
    /// Missing NVML, unsupported sensors and driver failures remain unavailable.
    pub fn sample(&mut self) -> (Option<f64>, Option<f64>) {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.nvml
                .as_ref()
                .map(nvml::Nvml::sample)
                .unwrap_or((None, None))
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            (None, None)
        }
    }
}

#[cfg(any(windows, target_os = "linux", test))]
fn select_gpu(
    readings: impl IntoIterator<Item = (Option<f64>, Option<f64>)>,
) -> (Option<f64>, Option<f64>) {
    readings.into_iter().fold((None, None), |best, current| {
        let replace = match (best.0, current.0) {
            (Some(previous), Some(usage)) => usage > previous,
            (None, Some(_)) => true,
            (None, None) => best.1.is_none() && current.1.is_some(),
            (Some(_), None) => false,
        };
        if replace {
            current
        } else {
            best
        }
    })
}

#[cfg(any(windows, target_os = "linux", test))]
fn usage_percent(value: u32) -> Option<f64> {
    (value <= 100).then_some(f64::from(value))
}

#[cfg(any(windows, target_os = "linux", test))]
fn temperature_c(value: u32) -> Option<f64> {
    (value <= 200).then_some(f64::from(value))
}

#[cfg(any(windows, target_os = "linux"))]
mod nvml {
    use std::ffi::{c_int, c_uint, c_void};

    use libloading::Library;

    use super::{select_gpu, temperature_c, usage_percent};

    type Device = *mut c_void;
    type Init = unsafe extern "C" fn() -> c_int;
    type Shutdown = unsafe extern "C" fn() -> c_int;
    type DeviceCount = unsafe extern "C" fn(*mut c_uint) -> c_int;
    type DeviceByIndex = unsafe extern "C" fn(c_uint, *mut Device) -> c_int;
    type GetUtilization = unsafe extern "C" fn(Device, *mut Utilization) -> c_int;
    type GetTemperature = unsafe extern "C" fn(Device, c_int, *mut c_uint) -> c_int;

    const SUCCESS: c_int = 0;
    const TEMPERATURE_GPU: c_int = 0;

    // NVML's nvmlUtilization_t contains exactly two unsigned-int percentages.
    #[repr(C)]
    #[derive(Default)]
    struct Utilization {
        gpu: c_uint,
        memory: c_uint,
    }

    pub(super) struct Nvml {
        // The library outlives all copied function pointers and the shutdown call.
        _library: Library,
        shutdown: Shutdown,
        device_count: DeviceCount,
        device_by_index: DeviceByIndex,
        utilization: GetUtilization,
        temperature: GetTemperature,
    }

    impl Nvml {
        pub(super) fn new() -> Option<Self> {
            let library = load_library()?;
            // SAFETY: These signatures and C layouts match NVIDIA's public NVML
            // header. Symbols are copied only while their owning library is retained.
            let (init, shutdown, device_count, device_by_index, utilization, temperature) = unsafe {
                (
                    *library.get::<Init>(b"nvmlInit_v2\0").ok()?,
                    *library.get::<Shutdown>(b"nvmlShutdown\0").ok()?,
                    *library
                        .get::<DeviceCount>(b"nvmlDeviceGetCount_v2\0")
                        .ok()?,
                    *library
                        .get::<DeviceByIndex>(b"nvmlDeviceGetHandleByIndex_v2\0")
                        .ok()?,
                    *library
                        .get::<GetUtilization>(b"nvmlDeviceGetUtilizationRates\0")
                        .ok()?,
                    *library
                        .get::<GetTemperature>(b"nvmlDeviceGetTemperature\0")
                        .ok()?,
                )
            };
            // SAFETY: Resolved initialization takes no parameters. No query is made
            // unless NVML confirms successful initialization of this session.
            if unsafe { init() } != SUCCESS {
                return None;
            }
            Some(Self {
                _library: library,
                shutdown,
                device_count,
                device_by_index,
                utilization,
                temperature,
            })
        }

        pub(super) fn sample(&self) -> (Option<f64>, Option<f64>) {
            let mut count = 0;
            // SAFETY: The output points to initialized writable storage and the
            // live NVML session owns every handle used below for this one sample.
            if unsafe { (self.device_count)(&mut count) } != SUCCESS {
                return (None, None);
            }
            select_gpu((0..count).filter_map(|index| {
                let mut device = std::ptr::null_mut();
                // SAFETY: The function initializes the device output. Failed or null
                // handles are never passed to subsequent sensor queries.
                if unsafe { (self.device_by_index)(index, &mut device) } != SUCCESS
                    || device.is_null()
                {
                    return None;
                }
                let mut utilization = Utilization::default();
                let mut temperature = 0;
                // SAFETY: Both calls use the same valid device handle and correctly
                // sized writable output buffers. Return status guards every value.
                let usage = if unsafe { (self.utilization)(device, &mut utilization) } == SUCCESS {
                    usage_percent(utilization.gpu)
                } else {
                    None
                };
                let temperature =
                    if unsafe { (self.temperature)(device, TEMPERATURE_GPU, &mut temperature) }
                        == SUCCESS
                    {
                        temperature_c(temperature)
                    } else {
                        None
                    };
                Some((usage, temperature))
            }))
        }
    }

    impl Drop for Nvml {
        fn drop(&mut self) {
            // SAFETY: A successfully initialized session is shut down exactly once,
            // before Rust drops the library containing this function.
            unsafe { (self.shutdown)() };
        }
    }

    #[cfg(windows)]
    fn load_library() -> Option<Library> {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use std::path::PathBuf;

        use libloading::os::windows::{
            Library as WindowsLibrary, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
            LOAD_LIBRARY_SEARCH_SYSTEM32,
        };

        #[link(name = "kernel32")]
        extern "system" {
            fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
        }

        let mut directory = [0u16; 32768];
        // SAFETY: The buffer has the supplied capacity; the Win32 API writes at
        // most that many UTF-16 units. Environment variables cannot redirect it.
        let length = unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) };
        if length == 0 || length as usize >= directory.len() {
            return None;
        }
        let path =
            PathBuf::from(OsString::from_wide(&directory[..length as usize])).join("nvml.dll");
        // SAFETY: Load only the installed system driver library. Dependency lookup
        // is restricted to its directory/System32, excluding the current directory.
        unsafe {
            WindowsLibrary::load_with_flags(
                path,
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
        }
        .ok()
        .map(Library::from)
    }

    #[cfg(target_os = "linux")]
    fn load_library() -> Option<Library> {
        // SAFETY: This is NVIDIA's system-installed versioned driver library,
        // resolved using the platform's normal shared-library loader.
        unsafe { Library::new("libnvidia-ml.so.1") }.ok()
    }
}

#[cfg(test)]
mod tests {
    use super::{select_gpu, temperature_c, usage_percent};

    #[test]
    fn chooses_busiest_gpu_without_borrowing_another_devices_temperature() {
        assert_eq!(
            select_gpu([(Some(15.0), Some(70.0)), (Some(90.0), Some(42.0))]),
            (Some(90.0), Some(42.0))
        );
        assert_eq!(
            select_gpu([(Some(15.0), Some(70.0)), (Some(90.0), None)]),
            (Some(90.0), None)
        );
    }

    #[test]
    fn zero_usage_and_unavailable_utilization_remain_distinct() {
        assert_eq!(usage_percent(0), Some(0.0));
        assert_eq!(usage_percent(100), Some(100.0));
        assert_eq!(usage_percent(101), None);
        assert_eq!(temperature_c(u32::MAX), None);
        assert_eq!(
            select_gpu([(None, Some(50.0)), (Some(0.0), Some(35.0))]),
            (Some(0.0), Some(35.0))
        );
        assert_eq!(select_gpu([(None, Some(50.0))]), (None, Some(50.0)));
        assert_eq!(select_gpu([]), (None, None));
    }
}
