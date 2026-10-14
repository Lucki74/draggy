//! Keeps one account runtime alive only while it is wanted: started on first use, stopped after ten idle minutes or
//! on quit, restarted after a crash with backoff, and given up on after the third. The clock and the sleeps are passed
//! in, so a test runs the whole life of a runtime without waiting.

use std::fmt;

use tracing::{info, warn};

use crate::gateway::Sleeper;

pub const IDLE_MS: u64 = 10 * 60 * 1000;
pub const BACKOFF_MS: [u64; 3] = [1000, 4000, 16000];

/// The state a runtime is in, as the renderer may show it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Stopped,
    Starting,
    Running,
    Unavailable,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Stopped => "stopped",
            State::Starting => "starting",
            State::Running => "running",
            State::Unavailable => "unavailable",
        }
    }
}

/// A started runtime: the supervisor only needs to be able to stop it.
pub trait Instance {
    fn stop(&mut self);
}

/// Refused: the runtime could not start, or it was given up on after crashing too often.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeUnavailable(pub String);

impl fmt::Display for RuntimeUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeUnavailable {}

/// Starts one runtime. The owner calls `exited` with the generation the runtime was started under when it goes away.
pub struct Supervisor<'a> {
    start: Box<dyn FnMut() -> Result<Box<dyn Instance>, String> + 'a>,
    sleeper: &'a dyn Sleeper,
    on_state: Box<dyn FnMut(State) + 'a>,
    idle_ms: u64,
    backoff_ms: Vec<u64>,
    state: State,
    current: Option<(u64, Box<dyn Instance>)>,
    users: u32,
    idle_deadline: Option<u64>,
    crashes: usize,
    generation: u64,
}

impl<'a> Supervisor<'a> {
    pub fn new(
        start: Box<dyn FnMut() -> Result<Box<dyn Instance>, String> + 'a>,
        sleeper: &'a dyn Sleeper,
        on_state: Box<dyn FnMut(State) + 'a>,
    ) -> Self {
        Self {
            start,
            sleeper,
            on_state,
            idle_ms: IDLE_MS,
            backoff_ms: BACKOFF_MS.to_vec(),
            state: State::Stopped,
            current: None,
            users: 0,
            idle_deadline: None,
            crashes: 0,
            generation: 0,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }

    /// The generation the running runtime was started under, if one is running.
    pub fn current_generation(&self) -> Option<u64> {
        self.current.as_ref().map(|(generation, _)| *generation)
    }

    /// The running runtime, for the caller to talk to.
    pub fn current(&mut self) -> Option<&mut (dyn Instance + 'static)> {
        self.current.as_mut().map(|(_, instance)| &mut **instance)
    }

    /// Hands out the running runtime, starting it if needed. Every acquire needs its release.
    pub fn acquire(&mut self, now: u64) -> Result<(), RuntimeUnavailable> {
        if self.state == State::Unavailable {
            return Err(RuntimeUnavailable(
                "The runtime crashed too often and was given up on".to_owned(),
            ));
        }
        self.users += 1;
        self.clear_idle();
        if self.current.is_some() {
            return Ok(());
        }
        match self.launch() {
            Ok(()) => Ok(()),
            Err(error) => {
                self.release(now);
                Err(error)
            }
        }
    }

    /// Lets go of one acquire. The last one to let go starts the idle clock.
    pub fn release(&mut self, now: u64) {
        self.users = self.users.saturating_sub(1);
        if self.users > 0 || self.current.is_none() {
            return;
        }
        self.clear_idle();
        self.idle_deadline = Some(now + self.idle_ms);
    }

    /// Moves the clock on: a runtime idle for the whole window is stopped.
    pub fn tick(&mut self, now: u64) {
        if self.idle_deadline.is_some_and(|deadline| deadline <= now) {
            self.idle_deadline = None;
            self.stop();
        }
    }

    /// Stops on purpose, for idle and quit. A stop on purpose is never counted as a crash.
    pub fn stop(&mut self) {
        self.generation += 1;
        self.clear_idle();
        let instance = self.current.take();
        // A run that lasted until it idled out clears the count, so a crash a week ago is never three.
        if self.state != State::Unavailable {
            if instance.is_some() {
                self.crashes = 0;
            }
            self.set(State::Stopped);
        }
        if let Some((_, mut instance)) = instance {
            instance.stop();
        }
    }

    /// The runtime started under `generation` went away on its own.
    pub fn exited(&mut self, generation: u64) {
        self.crashed(generation);
    }

    /// After the user asks to try again, a runtime given up on gets its chances back.
    pub fn reset(&mut self) {
        self.crashes = 0;
        if self.state == State::Unavailable {
            self.set(State::Stopped);
        }
    }

    fn launch(&mut self) -> Result<(), RuntimeUnavailable> {
        self.generation += 1;
        let which = self.generation;
        self.set(State::Starting);
        if self.crashes > 0 {
            let index = self.crashes - 1;
            let wait = self
                .backoff_ms
                .get(index)
                .or(self.backoff_ms.last())
                .copied()
                .unwrap_or(0);
            self.sleeper.wait(wait);
        }
        match (self.start)() {
            Ok(instance) => {
                self.current = Some((which, instance));
                self.set(State::Running);
                info!(target: "providers.account", "runtime started");
                Ok(())
            }
            Err(message) => {
                warn!(target: "providers.account", attempt = self.crashes + 1, "runtime start failed");
                if which == self.generation {
                    self.crashed(which);
                }
                Err(RuntimeUnavailable(message))
            }
        }
    }

    fn crashed(&mut self, which: u64) {
        if which != self.generation {
            return;
        }
        self.current = None;
        self.clear_idle();
        self.crashes += 1;
        warn!(target: "providers.account", crashes = self.crashes, "runtime crashed");
        let next = if self.crashes > self.backoff_ms.len() {
            State::Unavailable
        } else {
            State::Stopped
        };
        self.set(next);
    }

    fn clear_idle(&mut self) {
        self.idle_deadline = None;
    }

    fn set(&mut self, next: State) {
        if self.state == next {
            return;
        }
        info!(target: "providers.account", from = self.state.name(), to = next.name(), "runtime state");
        self.state = next;
        (self.on_state)(next);
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use super::*;

    /// Records each wait instead of sleeping.
    #[derive(Default)]
    struct Waits(RefCell<Vec<u64>>);

    impl Sleeper for Waits {
        fn wait(&self, ms: u64) -> bool {
            self.0.borrow_mut().push(ms);
            true
        }
    }

    /// A runtime that counts its starts and stops, and can be told to fail its first starts.
    #[derive(Clone, Default)]
    struct Fake {
        starts: Rc<Cell<u32>>,
        stops: Rc<Cell<u32>>,
        fail_starts: Rc<Cell<u32>>,
    }

    struct Live {
        stops: Rc<Cell<u32>>,
    }

    impl Instance for Live {
        fn stop(&mut self) {
            self.stops.set(self.stops.get() + 1);
        }
    }

    impl Fake {
        fn supervisor<'a>(
            &self,
            waits: &'a Waits,
            states: Rc<RefCell<Vec<State>>>,
        ) -> Supervisor<'a> {
            let fake = self.clone();
            Supervisor::new(
                Box::new(move || {
                    fake.starts.set(fake.starts.get() + 1);
                    if fake.starts.get() <= fake.fail_starts.get() {
                        return Err("spawn failed".to_owned());
                    }
                    Ok(Box::new(Live {
                        stops: fake.stops.clone(),
                    }) as Box<dyn Instance>)
                }),
                waits,
                Box::new(move |state| states.borrow_mut().push(state)),
            )
        }
    }

    fn states() -> Rc<RefCell<Vec<State>>> {
        Rc::new(RefCell::new(Vec::new()))
    }

    #[test]
    fn starts_nothing_until_first_used_then_shares_one_runtime() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let mut sup = fake.supervisor(&waits, states());
        assert_eq!(fake.starts.get(), 0);
        sup.acquire(0).expect_ok();
        sup.acquire(0).expect_ok();
        assert_eq!(fake.starts.get(), 1);
        assert_eq!(sup.state(), State::Running);
    }

    #[test]
    fn stops_ten_minutes_after_the_last_user_lets_go_and_not_while_one_holds_on() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let mut sup = fake.supervisor(&waits, states());
        sup.acquire(0).expect_ok();
        sup.acquire(0).expect_ok();
        sup.release(0);
        sup.tick(IDLE_MS * 2);
        assert_eq!(fake.stops.get(), 0);
        sup.release(IDLE_MS * 2);
        sup.tick(IDLE_MS * 2 + IDLE_MS - 1);
        assert_eq!(fake.stops.get(), 0);
        sup.tick(IDLE_MS * 3);
        assert_eq!(fake.stops.get(), 1);
        assert_eq!(sup.state(), State::Stopped);
    }

    #[test]
    fn stops_at_once_on_quit_and_a_stop_on_purpose_is_not_a_crash() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let mut sup = fake.supervisor(&waits, states());
        sup.acquire(0).expect_ok();
        let launched = sup.current_generation().unwrap_or_default();
        sup.stop();
        sup.exited(launched);
        assert_eq!(fake.stops.get(), 1);
        sup.acquire(0).expect_ok();
        assert!(waits.0.borrow().is_empty());
    }

    #[test]
    fn restarts_after_a_crash_with_growing_backoff_and_gives_up_after_the_third() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let mut sup = fake.supervisor(&waits, states());
        for _ in 0..3 {
            sup.acquire(0).expect_ok();
            sup.release(0);
            let launched = sup.current_generation().unwrap_or_default();
            sup.exited(launched);
        }
        assert_eq!(*waits.0.borrow(), vec![1000, 4000]);
        sup.acquire(0).expect_ok();
        let launched = sup.current_generation().unwrap_or_default();
        sup.exited(launched);
        assert_eq!(*waits.0.borrow(), vec![1000, 4000, 16000]);
        assert_eq!(sup.state(), State::Unavailable);
        let refused = sup.acquire(0);
        assert!(refused.is_err());
        assert_eq!(fake.starts.get(), 4);
    }

    #[test]
    fn counts_a_start_that_fails_as_a_crash() {
        let (waits, fake) = (Waits::default(), Fake::default());
        fake.fail_starts.set(4);
        let mut sup = fake.supervisor(&waits, states());
        for _ in 0..4 {
            assert!(sup.acquire(0).is_err());
        }
        assert_eq!(sup.state(), State::Unavailable);
        sup.reset();
        assert_eq!(sup.state(), State::Stopped);
        sup.acquire(0).expect_ok();
        assert_eq!(fake.starts.get(), 5);
    }

    #[test]
    fn forgets_old_crashes_once_a_run_idles_out_cleanly() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let mut sup = fake.supervisor(&waits, states());
        sup.acquire(0).expect_ok();
        let launched = sup.current_generation().unwrap_or_default();
        sup.exited(launched);
        sup.acquire(0).expect_ok();
        sup.release(0);
        sup.tick(IDLE_MS);
        sup.acquire(IDLE_MS).expect_ok();
        assert_eq!(*waits.0.borrow(), vec![1000]);
    }

    #[test]
    fn reports_each_state_change_once() {
        let (waits, fake) = (Waits::default(), Fake::default());
        let seen = states();
        let mut sup = fake.supervisor(&waits, seen.clone());
        sup.acquire(0).expect_ok();
        sup.stop();
        let names: Vec<&str> = seen.borrow().iter().map(|state| state.name()).collect();
        assert_eq!(names, vec!["starting", "running", "stopped"]);
    }

    trait ExpectOk {
        fn expect_ok(self);
    }

    impl ExpectOk for Result<(), RuntimeUnavailable> {
        fn expect_ok(self) {
            assert!(self.is_ok(), "acquire failed: {self:?}");
        }
    }
}
