use std::io;

use tokio::process::{Child, Command};

pub(crate) struct ProcessTree {
    #[cfg(windows)]
    job: windows::Job,
}

impl ProcessTree {
    pub(crate) fn prepare(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        {
            let job = windows::Job::create()?;
            windows::configure_suspended(command);
            Ok(Self { job })
        }
        #[cfg(not(windows))]
        {
            let _ = command;
            Ok(Self {})
        }
    }

    pub(crate) fn attach_and_start(&self, child: &Child) -> io::Result<()> {
        #[cfg(windows)]
        {
            self.job.attach_and_resume(child)
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(())
        }
    }

    pub(crate) async fn terminate(&self, child: &mut Child) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    pub(crate) fn terminate_remaining(&self) {
        #[cfg(windows)]
        self.job.terminate();
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::io;
    use std::mem::size_of;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

    use tokio::process::{Child, Command};
    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{
        CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME,
    };

    pub(super) struct Job(OwnedHandle);

    impl Job {
        pub(super) fn create() -> io::Result<Self> {
            let raw_job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if raw_job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = unsafe { OwnedHandle::from_raw_handle(raw_job as RawHandle) };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job.as_raw_handle() as HANDLE,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast::<c_void>(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(job))
        }

        pub(super) fn attach_and_resume(&self, child: &Child) -> io::Result<()> {
            let process_handle = child
                .raw_handle()
                .ok_or_else(|| io::Error::other("child exited before job assignment"))?
                as HANDLE;
            let assigned = unsafe {
                AssignProcessToJobObject(self.0.as_raw_handle() as HANDLE, process_handle)
            };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            resume_primary_thread(
                child
                    .id()
                    .ok_or_else(|| io::Error::other("child exited before thread resume"))?,
            )
        }

        pub(super) fn terminate(&self) {
            let terminated = unsafe { TerminateJobObject(self.0.as_raw_handle() as HANDLE, 1) };
            if terminated == 0 {
                tracing::debug!(
                    error = ?io::Error::last_os_error(),
                    "Windows job termination returned an error"
                );
            }
        }
    }

    pub(super) fn configure_suspended(command: &mut Command) {
        command.creation_flags(CREATE_SUSPENDED);
    }

    fn resume_primary_thread(process_id: u32) -> io::Result<()> {
        let raw_snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if raw_snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let snapshot = unsafe { OwnedHandle::from_raw_handle(raw_snapshot as RawHandle) };
        let mut entry = THREADENTRY32 {
            dwSize: size_of::<THREADENTRY32>() as u32,
            ..THREADENTRY32::default()
        };
        if unsafe { Thread32First(snapshot.as_raw_handle() as HANDLE, &mut entry) } == 0 {
            return Err(io::Error::last_os_error());
        }

        loop {
            if entry.th32OwnerProcessID == process_id {
                let raw_thread =
                    unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if raw_thread.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let thread = unsafe { OwnedHandle::from_raw_handle(raw_thread as RawHandle) };
                if unsafe { ResumeThread(thread.as_raw_handle() as HANDLE) } == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                return Ok(());
            }
            if unsafe { Thread32Next(snapshot.as_raw_handle() as HANDLE, &mut entry) } == 0 {
                break;
            }
        }

        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("primary thread for process {process_id} was not found"),
        ))
    }
}
