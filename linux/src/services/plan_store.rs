use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub title: String,
    pub status: StepStatus,
    pub details: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub id: String,
    pub goal: String,
    pub steps: Vec<PlanStep>,
}

#[derive(Default, Clone)]
pub struct PlanStore {
    pub current_plan: Arc<Mutex<Option<ExecutionPlan>>>,
}

impl PlanStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_plan(&self, goal: &str, steps: Vec<String>) {
        let step_items = steps
            .into_iter()
            .enumerate()
            .map(|(i, s)| PlanStep {
                id: format!("step-{}", i + 1),
                title: s,
                status: StepStatus::Pending,
                details: None,
            })
            .collect();

        *self.current_plan.lock().unwrap() = Some(ExecutionPlan {
            id: "plan-1".to_string(),
            goal: goal.to_string(),
            steps: step_items,
        });
    }

    pub fn update_step_status(&self, step_id: &str, status: StepStatus) {
        if let Some(ref mut plan) = *self.current_plan.lock().unwrap() {
            if let Some(step) = plan.steps.iter_mut().find(|s| s.id == step_id) {
                step.status = status;
            }
        }
    }
}
